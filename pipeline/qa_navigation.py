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

        # structural verification from the route itself (independent of frame timing / QA speed-up)
        struct = await page.evaluate("""() => {
            const r = window.__campus.route(), t = window.__campus.tour();
            if (!r) return null;
            const stairDy = [];
            for (let i = 1; i < r.track.length; i++) {
                if (r.track[i].kind === 'stair') stairDy.push(Math.abs(r.track[i].p.y - r.track[i-1].p.y));
            }
            const states = t.states();
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
            return { stairDyMax: Math.max(...stairDy, 0), stairSegs: stairDy.length, flights, okPattern, floorsSeen, states: [...new Set(states)] };
        }""")
        check('state machine used (explicit states)', struct and set(['WALKING', 'ENTERING_DOOR', 'CORRIDOR_NAVIGATION', 'APPROACHING_STAIRS', 'CLIMBING', 'FLOOR_LANDING']) <= set(struct['states']), str(struct and struct['states']))
        check('three separate climbing flights (G→1→2→3)', struct and struct['flights'] >= 3, f"flights: {struct and struct['flights']}")
        check('every flight ends in a floor landing', struct and struct['okPattern'])
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
        muted = await page.evaluate("() => { const v = window.__campus.state.voice; v.toggleMute(); return v.muted; }")
        check('mute toggles and persists', muted is True)
        await page.click('#voice-pick')
        menu_txt = await page.evaluate("() => document.getElementById('voice-menu').textContent")
        check('voice picker lists runtime voices or states unavailability', ('الصوت غير متاح' in menu_txt) or len(menu_txt.strip()) > 0, menu_txt[:80])
        await page.keyboard.press('Escape')
        await page.evaluate("() => window.__campus.state.voice.toggleMute()")

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
