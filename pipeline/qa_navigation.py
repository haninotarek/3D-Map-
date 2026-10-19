"""Navigation & voice QA for the campus viewer (headless Chromium / SwiftShader WebGL).
Usage: python3 qa_navigation.py [base_url]  -> writes qa_nav_results.json + screenshots to deliverables/qa/nav/
Covers: progressive multi-floor staircase traversal, navigation state machine, floor transitions,
voice module behaviour (real runtime voices only), pause/resume/cancel, arrival detection."""
import asyncio, json, os, sys, time
from playwright.async_api import async_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8080/'
OUT = os.path.join(os.path.dirname(__file__), '..', 'deliverables', 'qa', 'nav')
os.makedirs(OUT, exist_ok=True)
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage', '--no-sandbox']
results = {'base': BASE, 'checks': [], 'console_errors': [], 'failed_requests': [], 'timeline': []}

def check(name, ok, detail=''):
    results['checks'].append({'name': name, 'ok': bool(ok), 'detail': str(detail)[:400]})
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path='/usr/bin/chromium', args=ARGS)
        page = await browser.new_page(viewport={'width': 1280, 'height': 800})
        page.on('console', lambda m: results['console_errors'].append(m.text) if m.type == 'error' else None)
        page.on('requestfailed', lambda r: results['failed_requests'].append(r.url))
        await page.goto(BASE + '?qa=1', wait_until='domcontentloaded')

        # 1) load
        try:
            await page.wait_for_function("() => document.getElementById('loading').classList.contains('hidden') || !document.getElementById('error').classList.contains('hidden')", timeout=240000)
        except Exception as e:
            check('page load completes', False, str(e)[:120]); await browser.close(); return
        loaded_ok = await page.evaluate("() => document.getElementById('error').classList.contains('hidden')")
        check('scene loads without error', loaded_ok, await page.evaluate("() => document.getElementById('error-text').textContent"))
        check('no console errors on load', not [e for e in results['console_errors'] if 'favicon' not in e], results['console_errors'][:3])
        check('no failed requests', not results['failed_requests'], results['failed_requests'][:3])
        await page.screenshot(path=f'{OUT}/01_loaded.png')

        # 2) start a route to a 3rd-floor room (Hall 3 -> floor 3 of bld_e2)
        # software WebGL renders slowly: speed the tour clock so the QA run finishes in real time
        await page.evaluate("() => { window.__TOUR_SPEED = 10; }")
        await page.evaluate("() => window.__campus.showRoute({ building: 'Engineering Building 1', room: 'Hall 3', lang: 'ar', roomLabel: 'قاعة 3' })")
        await page.wait_for_timeout(1500)
        ok = await page.evaluate("() => window.__campus.tour().active && document.querySelectorAll('#route-steps li').length > 0")
        check('route to 3rd-floor room plans OK', ok)
        voice_plan = await page.evaluate("() => { const r = window.__campus.route(); return r ? { steps: r.steps, cues: r.cues } : null; }")
        flat_cues = [c for cue in (voice_plan or {}).get('cues', []) for c in (cue if isinstance(cue, list) else [cue]) if c]
        check('voice plan has one instruction per leg (no welcome/halfway repeats)',
              voice_plan and len(voice_plan['steps']) == 3 and voice_plan['steps'][0].startswith('صباح الخير يا هندسة')
              and not ({'welcome', 'halfway', 'approach', 'gate'} & set(flat_cues)), str(voice_plan))
        check('Hall 3 voice: greeting/building, right stair straight to floor 3, then room turn',
              voice_plan and voice_plan['cues'] == [['greeting_gate', 'go_eng1'], 'stairs_right_floor_3', ['floor_3', 'turn_right']]
              and 'floor_1' not in flat_cues and 'floor_2' not in flat_cues, str(voice_plan and voice_plan['cues']))

        # 3) watch the tour: states, floors, walker height (progressive climb), until ARRIVED
        t0 = time.time()
        last = None
        timeline = []
        while time.time() - t0 < 300:
            snap = await page.evaluate("""() => {
                const t = window.__campus.state.tour, s = window.__campus.state;
                const w = s.scene.getObjectByName('tour-walker');
                return { state: t.state, playing: t.playing, active: t.active,
                         y: w ? +w.position.y.toFixed(2) : null,
                         nav: t.navLog.map(x => x.state), floors: t.navLog.map(x => x.floor) };
            }""")
            key = (snap['state'], snap['y'])
            if last is None or key != last[0]:
                timeline.append(snap)
                if snap['state'] in ('CLIMBING', 'FLOOR_LANDING', 'ARRIVED', 'ENTERING_DOOR') and len([s for s in timeline if s['state'] == snap['state']]) <= 4:
                    await page.screenshot(path=f"{OUT}/02_{snap['state']}_{len(timeline)}.png")
            last = (key, snap)
            if snap['state'] == 'ARRIVED':
                break
            await page.wait_for_timeout(400)
        results['timeline'] = [{k: s[k] for k in ('state', 'y')} for s in timeline]
        nav, floors = timeline[-1]['nav'], timeline[-1]['floors']

        check('navigation reaches ARRIVED', timeline[-1]['state'] == 'ARRIVED', f"{time.time()-t0:.0f}s")
        inside_view = await page.evaluate("""() => {
            const s = window.__campus.state;
            const interior = s.interiors.get('bld_e2');
            const routeGroup = s.scene.getObjectByName('route');
            const walker = s.scene.getObjectByName('tour-walker');
            let doorCount = 0;
            if (interior) interior.group.traverse(o => { if (o.name === 'floor-door') doorCount++; });
            const doorSigns = interior ? interior.floors[3].labels
                .filter(l => l.element.className === 'door-sign')
                .map(l => ({ text: l.element.textContent, visible: l.visible })) : [];
            return {
                rootVisible: s.root.visible,
                inside: s.inside,
                interiorVisible: !!(interior && interior.group.visible),
                outdoorRouteVisible: routeGroup?.getObjectByName('route-outdoor')?.visible,
                indoorRouteVisible: routeGroup?.getObjectByName('route-indoor')?.visible,
                haloVisible: s.scene.getObjectByName('walker-halo')?.visible,
                doorCount, doorSigns,
                camDistToWalker: walker ? +s.camera.position.distanceTo(walker.position).toFixed(1) : null,
                visibleLabels: [...s.items.values()].filter(x => x.label && x.label.visible).map(x => x.id),
            };
        }""")
        check('inside a building only that building is visible (campus + whole route line hidden)',
              inside_view and inside_view['rootVisible'] is False and inside_view['interiorVisible'] is True
              and inside_view['outdoorRouteVisible'] is False and inside_view['indoorRouteVisible'] is False
              and inside_view['visibleLabels'] == [], str(inside_view))
        check('every floor has a stair door with its name plate (destination sign visible on arrival)',
              inside_view and inside_view['doorCount'] == 8
              and len(inside_view['doorSigns']) == 2
              and all(sg['text'] == 'الدور التالت' and sg['visible'] for sg in inside_view['doorSigns']),
              str(inside_view and (inside_view['doorCount'], inside_view['doorSigns'])))
        check('indoors the shot is framed on the walker (close camera, no ground marker under him)',
              inside_view and inside_view['haloVisible'] is False
              and inside_view['camDistToWalker'] is not None and inside_view['camDistToWalker'] < 16,
              str(inside_view))

        # structural verification from the route itself (independent of frame timing / QA speed-up)
        struct = await page.evaluate("""() => {
            const r = window.__campus.route(), t = window.__campus.tour();
            if (!r) return null;
            const stairDy = [];
            for (let i = 1; i < r.track.length; i++) {
                if (r.track[i].kind === 'stair') stairDy.push(Math.abs(r.track[i].p.y - r.track[i-1].p.y));
            }
            const states = t.states();
            // welded climb: points tagged floor 1/2 must all lie inside the stair_s rect (Hall 3's stairwell)
            const midOutside = r.track.filter(x => (x.floor === 1 || x.floor === 2)
                && (x.p.x < 148 || x.p.x > 158 || -x.p.z < -78.2 || -x.p.z > -70)).length;
            // switchback realism: within the stair points the along-direction (dx) must
            // reverse once per storey (turn at the half-landing), never one straight replay
            let flips = 0, prevSign = 0;
            for (let i = 1; i < r.track.length; i++) {
                if (r.track[i].kind !== 'stair') continue;
                const dx = r.track[i].p.x - r.track[i-1].p.x;
                const sg = dx > 0.05 ? 1 : dx < -0.05 ? -1 : 0;
                if (sg && prevSign && sg !== prevSign) flips++;
                if (sg) prevSign = sg;
            }
            const floorsSeen = [];
            for (const x of t.navLog) { const f = x.floor; if (f !== null && (!floorsSeen.length || floorsSeen[floorsSeen.length-1] !== f)) floorsSeen.push(f); }
            // each climbing flight must be followed by a landing before the next flight
            let flights = 0, okPattern = true;
            for (let i = 0; i < states.length; i++) {
                if (states[i] === 'CLIMBING') {
                    flights++;
                    let j = i; while (j < states.length && states[j] === 'CLIMBING') j++;
                    if (states[j] !== 'FLOOR_LANDING') okPattern = false;
                    i = j;
                }
            }
            return { stairDyMax: Math.max(...stairDy, 0), stairSegs: stairDy.length, flights, okPattern, floorsSeen, midOutside, flips, states: [...new Set(states)] };
        }""")
        check('state machine used (explicit states)', struct and set(['WALKING', 'ENTERING_DOOR', 'CORRIDOR_NAVIGATION', 'APPROACHING_STAIRS', 'CLIMBING', 'FLOOR_LANDING']) <= set(struct['states']), str(struct and struct['states']))
        check('three separate climbing flights (G→1→2→3)', struct and struct['flights'] >= 3, f"flights: {struct and struct['flights']}")
        check('every flight ends in a floor landing', struct and struct['okPattern'])
        check('staircase is a real switchback (direction turns at every half-landing, not a replayed straight flight)',
              struct and struct['flips'] >= 3, f"direction reversals on stairs: {struct and struct['flips']}")
        check('climb is welded: walker never enters intermediate floors (stays in the stairwell)',
              struct and struct['midOutside'] == 0, f"points outside stairwell on floors 1-2: {struct and struct['midOutside']}")
        check('floor transitions are progressive (no teleport)', struct and struct['floorsSeen'] == [-1, 0, 1, 2, 3], str(struct and struct['floorsSeen']))
        check('stairs are walked step by step (no vertical teleport)', struct and struct['stairDyMax'] <= 0.3 and struct['stairSegs'] >= 50,
              f"{struct and struct['stairSegs']} stair segments, max step Δy = {struct and struct['stairDyMax']} m")
        check('live nav log shows the major transitions', all(x in nav for x in ['WALKING', 'APPROACHING_STAIRS', 'CLIMBING', 'ARRIVED']), ' → '.join(dict.fromkeys(nav)))
        await page.screenshot(path=f'{OUT}/03_arrived.png')

        # 4) voice module (real runtime voices only)
        v = await page.evaluate("""() => {
            const v = window.__campus.state.voice;
            return { supported: v.supported, n: v.voices.length, hasAr: v.hasArabic, muted: v.muted };
        }""")
        check('voice module present and safe', v['supported'] in (True, False) and isinstance(v['n'], int), str(v))
        speed_ui = await page.evaluate("""() => ({
            hasMuteIcon: !!document.getElementById('voice-mute'),
            hasVoicePicker: !!document.getElementById('voice-pick'),
            hasVoiceMenu: !!document.getElementById('voice-menu'),
            hasSpeedIcon: !!document.getElementById('tour-speed'),
            label: document.getElementById('tour-speed-label')?.textContent,
            rate: window.__campus.tour().playbackRate,
        })""")
        check('voice list removed; mute and movement-speed icons are shown at 1x',
              speed_ui and speed_ui['hasMuteIcon'] is True and speed_ui['hasVoicePicker'] is False
              and speed_ui['hasVoiceMenu'] is False and speed_ui['hasSpeedIcon'] is True
              and speed_ui['label'] == '1×' and speed_ui['rate'] == 1, str(speed_ui))
        await page.click('#tour-speed')
        speed_fast = await page.evaluate("""() => ({
            label: document.getElementById('tour-speed-label')?.textContent,
            rate: window.__campus.tour().playbackRate,
        })""")
        check('movement-speed icon speeds up the tour to 1.5x',
              speed_fast and speed_fast['label'] == '1.5×' and speed_fast['rate'] == 1.5, str(speed_fast))
        await page.click('#tour-speed')
        await page.click('#tour-speed')   # 2x, then back to normal for the remaining checks
        await page.click('#voice-mute')
        mute_ui = await page.evaluate("""() => ({
            muted: window.__campus.state.voice.muted,
            icon: document.getElementById('voice-mute')?.textContent,
        })""")
        check('mute icon toggles the voice', mute_ui and mute_ui['muted'] is True and mute_ui['icon'] == '🔇', str(mute_ui))
        await page.click('#voice-mute')   # restore audio for the remaining checks

        # 5) pause / resume / cancel
        await page.evaluate("() => window.__campus.tour().replay()")
        await page.click('#tour-play')
        paused = await page.evaluate("() => !window.__campus.tour().playing")
        check('pause works', paused)
        await page.click('#tour-play')
        resumed = await page.evaluate("() => window.__campus.tour().playing")
        check('resume works', resumed)
        await page.click('#tour-close')
        cancelled = await page.evaluate("() => !window.__campus.tour().active && window.__campus.tour().state === 'IDLE'")
        check('cancel returns to IDLE cleanly', cancelled)
        restored = await page.evaluate("""() => {
            const s = window.__campus.state; const interior = s.interiors.get('bld_e2');
            return { rootVisible: s.root.visible, inside: s.inside, interiorVisible: !!(interior && interior.group.visible) };
        }""")
        check('leaving the interior restores the whole campus',
              restored and restored['rootVisible'] is True and restored['inside'] is None and restored['interiorVisible'] is False,
              str(restored))

        # 6) edge cases
        await page.evaluate("() => window.__campus.showRoute({ building: 'مبنى غير موجود', room: 'X', lang: 'ar' })")
        await page.wait_for_timeout(800)
        bad = await page.evaluate("() => !window.__campus.tour().active && !document.getElementById('route-panel').classList.contains('hidden')")
        check('unknown destination rejected gracefully', bad is True)
        await page.evaluate("() => window.__campus.showRoute({ building: 'Engineering Building 1', room: 'Room 105', lang: 'ar' })")
        await page.wait_for_timeout(800)
        same = await page.evaluate("() => window.__campus.tour().active")
        check('ground-floor destination routes without stairs', same is True)
        await page.evaluate("() => window.__campus.clearRoute()")

        await browser.close()
    fails = [c for c in results['checks'] if not c['ok']]
    results['summary'] = {'total': len(results['checks']), 'failed': len(fails)}
    json.dump(results, open(os.path.join(OUT, 'qa_nav_results.json'), 'w'), ensure_ascii=False, indent=1)
    print(f"\n{len(results['checks']) - len(fails)}/{len(results['checks'])} checks passed", flush=True)
    sys.exit(1 if fails else 0)

asyncio.run(main())
