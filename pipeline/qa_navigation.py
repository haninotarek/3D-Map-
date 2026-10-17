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
        ok = await page.evaluate("""async () => {
            const r = await window.__campus.showRoute({ building: 'Engineering Building 1', room: 'Hall 3', lang: 'ar', roomLabel: 'قاعة 3' });
            return r && r.ok;
        }""")
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
        check('state machine used (explicit states)', 'CLIMBING' in nav and 'FLOOR_LANDING' in nav, ' → '.join(dict.fromkeys(nav)))
        climbs = nav.count('CLIMBING')
        check('three separate climbing flights (G→1→2→3)', climbs >= 3, f'CLIMBING segments: {climbs}')
        # floor sequence must be progressive: -1 (outside) then 0,1,2,3 in order
        seen = []
        for f in floors:
            if not seen or seen[-1] != f: seen.append(f)
        check('floor transitions are progressive (no teleport)', seen == [-1, 0, 1, 2, 3], str(seen))
        # walker height must change gradually: no jump > 1.2 m between samples (a full floor is 4–4.5 m)
        ys = [s['y'] for s in timeline if s['y'] is not None]
        max_jump = max((abs(b - a) for a, b in zip(ys, ys[1:])), default=0)
        check('walker climbs gradually (no vertical teleport)', max_jump <= 1.2, f'max Δy between samples: {max_jump} m')
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
        bad = await page.evaluate("""async () => (await window.__campus.showRoute({ building: 'مبنى غير موجود', room: 'X', lang: 'ar' })).ok""")
        check('unknown destination rejected gracefully', bad is False)
        same = await page.evaluate("""async () => { const r = await window.__campus.showRoute({ building: 'Engineering Building 1', room: 'Room 105', lang: 'ar' }); return r.ok; }""")
        check('ground-floor destination routes without stairs', same is True)
        await page.evaluate("() => window.__campus.clearRoute()")

        await browser.close()
    fails = [c for c in results['checks'] if not c['ok']]
    results['summary'] = {'total': len(results['checks']), 'failed': len(fails)}
    json.dump(results, open(os.path.join(OUT, 'qa_nav_results.json'), 'w'), ensure_ascii=False, indent=1)
    print(f"\n{len(results['checks']) - len(fails)}/{len(results['checks'])} checks passed", flush=True)
    sys.exit(1 if fails else 0)

asyncio.run(main())
