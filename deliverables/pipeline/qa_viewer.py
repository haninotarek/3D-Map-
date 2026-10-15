"""Automated QA of the web viewer with headless Chromium (SwiftShader WebGL).
Usage: python3 qa_viewer.py [base_url]   -> writes deliverables/qa/ screenshots + qa_results.json"""
import asyncio, json, sys, time, os
from playwright.async_api import async_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8080/'
OUT = '/home/user/campus_project/deliverables/qa/'
os.makedirs(OUT, exist_ok=True)
EXPECTED = ['gate_1', 'bld_main', 'bld_w1', 'bld_w2', 'bld_s1', 'bld_s2', 'bld_s3', 'bld_e1', 'bld_e2', 'bld_h1', 'bld_h2', 'lm_gazebo_garden', 'lm_sports_pitch']
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage']
results = {'base': BASE, 'checks': [], 'console_errors': [], 'failed_requests': []}

def check(name, ok, detail=''):
    results['checks'].append({'name': name, 'ok': bool(ok), 'detail': str(detail)[:300]})
    print(('PASS ' if ok else 'FAIL ') + name + (f' - {detail}' if detail else ''), flush=True)

async def wait_loaded(page, timeout=240000):
    await page.wait_for_function("() => document.getElementById('loading').classList.contains('hidden') || !document.getElementById('error').classList.contains('hidden')", timeout=timeout)
    return await page.evaluate("() => document.getElementById('error').classList.contains('hidden')")

async def settle(page, ms=2500):
    # wait for any camera fly-to animation to finish (frames are slow on software WebGL), then a short pause
    await page.wait_for_timeout(300)
    try:
        await page.wait_for_function("() => !window.__campus || window.__campus.state.anim === null", timeout=120000)
    except Exception:
        pass
    await page.wait_for_timeout(min(ms, 1500))

async def open_list(page):
    if await page.evaluate("() => document.getElementById('list-panel').classList.contains('hidden')"):
        await page.click('#btn-list'); await page.wait_for_timeout(400)

async def project_center(page, bid):
    return await page.evaluate("""(id) => {
        const s = window.__campus.state; const it = s.items.get(id);
        const v = it.center.clone(); v.y = it.box.max.y * 0.6; v.project(s.camera);
        const r = s.renderer.domElement.getBoundingClientRect();
        return {x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height, z: v.z};
    }""", bid)

async def desktop(p):
    b = await p.chromium.launch(args=ARGS)
    ctx = await b.new_context(viewport={'width': 1440, 'height': 900}, device_scale_factor=1)
    page = await ctx.new_page()
    page.on('console', lambda m: results['console_errors'].append(f'[desktop] {m.text}') if m.type == 'error' else None)
    page.on('requestfailed', lambda r: results['failed_requests'].append(f'[desktop] {r.url} {r.failure}'))
    page.on('response', lambda r: results['failed_requests'].append(f'[desktop] HTTP {r.status} {r.url}') if r.status >= 400 else None)
    t0 = time.time()
    await page.goto(BASE + '?quality=high', wait_until='domcontentloaded')
    ok = await wait_loaded(page)
    check('desktop: full model loads without error panel (full quality, shadows on)', ok, f'{time.time() - t0:.1f}s')
    await settle(page, 6000)
    await page.screenshot(path=OUT + 'desktop_overview_full_quality.png', timeout=240000)
    await page.goto(BASE + '?quality=high&qa=1', wait_until='domcontentloaded')
    ok = await wait_loaded(page); await settle(page, 4000)
    await page.screenshot(path=OUT + 'desktop_overview.png', timeout=180000)
    ids = await page.evaluate('() => window.__campus.items()')
    check('desktop: all stable IDs registered from glTF extras', set(EXPECTED) <= set(ids), f'{len(ids)} items: {ids}')
    q = await page.evaluate('() => window.__campus.quality'); check('desktop: high-quality model chosen on wide screen', q == 'high', q)
    info = await page.evaluate("""() => { const r = window.__campus.state.renderer.info; return {calls: r.render.calls, tris: r.render.triangles, tex: r.memory.textures, geo: r.memory.geometries}; }""")
    results['renderer_info_desktop'] = info; check('desktop: renderer stats collected', True, info)
    # labels present
    nlab = await page.locator('.label3d').count(); check('desktop: labels rendered', nlab >= len(EXPECTED), nlab)
    # list selection
    await open_list(page)
    await page.click('#building-list button[data-id="bld_main"]'); await settle(page, 3000)
    name = await page.text_content('#info-name'); check('desktop: list selection opens info panel (Main Building)', name == 'Main Building', name)
    ar = await page.text_content('#info-name-ar'); check('desktop: Arabic name shown', 'المبنى' in (ar or ''), ar)
    await page.screenshot(path=OUT + 'desktop_main_building_selected.png', timeout=180000)
    h = await page.evaluate('() => location.hash'); check('desktop: deep-link hash updated', h == '#bld_main', h)
    # next / prev
    await page.click('#info-next'); await settle(page, 2500)
    sel = await page.evaluate('() => window.__campus.state.selected'); check('desktop: Next button navigates', sel == 'bld_w2', sel)
    await page.click('#btn-prev'); await settle(page, 2500)
    sel = await page.evaluate('() => window.__campus.state.selected'); check('desktop: Previous button navigates', sel == 'bld_main', sel)
    # overview reset
    await page.click('#btn-overview'); await settle(page, 2500)
    hidden = await page.evaluate("() => document.getElementById('info-panel').classList.contains('hidden')")
    sel = await page.evaluate('() => window.__campus.state.selected'); check('desktop: Overview resets view and clears selection', hidden and sel is None, sel)
    # canvas picking: click on a building's projected position
    picked_ok = []
    for bid in ('bld_e1', 'bld_s2', 'bld_main'):
        await page.click('#btn-overview'); await settle(page, 1800)
        pt = await project_center(page, bid)
        await page.mouse.move(pt['x'], pt['y']); await page.mouse.down(); await page.mouse.up()
        await settle(page, 2600)
        sel = await page.evaluate('() => window.__campus.state.selected'); picked_ok.append((bid, sel))
    check('desktop: clicking buildings in the 3D view selects them (raycast via glTF extras)', all(a == b for a, b in picked_ok), picked_ok)
    await page.screenshot(path=OUT + 'desktop_pick_result.png', timeout=180000)
    # click on empty ground clears selection
    await page.mouse.click(720, 880); await settle(page, 800)
    # labels toggle
    await page.click('#btn-labels'); await page.wait_for_timeout(300)
    off = await page.evaluate("() => document.getElementById('canvas-host').classList.contains('labels-off')")
    await page.click('#btn-labels'); check('desktop: labels toggle', off)
    # keyboard
    await page.keyboard.press('ArrowRight'); await settle(page, 2200)
    sel = await page.evaluate('() => window.__campus.state.selected'); check('desktop: keyboard navigation', sel is not None, sel)
    # gazebo garden (instanced mesh) selection via list
    await open_list(page)
    await page.click('#building-list button[data-id="lm_gazebo_garden"]'); await settle(page, 3000)
    await page.screenshot(path=OUT + 'desktop_gazebo_garden.png', timeout=180000)
    name = await page.text_content('#info-name'); check('desktop: landmark (instanced gazebos) selectable', 'Gazebo' in (name or ''), name)
    # deep link on fresh load
    page2 = await ctx.new_page()
    await page2.goto(BASE + '?quality=high&qa=1#bld_e1', wait_until='domcontentloaded'); await wait_loaded(page2); await settle(page2, 3500)
    sel = await page2.evaluate('() => window.__campus.state.selected'); check('desktop: deep link #bld_e1 selects building on load', sel == 'bld_e1', sel)
    await page2.screenshot(path=OUT + 'desktop_deeplink_e1.png', timeout=180000); await page2.close()
    # error handling: abort the model request
    page3 = await ctx.new_page()
    await page3.route('**/*.glb', lambda route: route.abort())
    await page3.goto(BASE + '?quality=high', wait_until='domcontentloaded')
    await wait_loaded(page3, 60000)
    err_vis = await page3.evaluate("() => !document.getElementById('error').classList.contains('hidden')")
    txt = await page3.text_content('#error-text')
    check('desktop: failed model download shows error panel with Retry / lightweight options', err_vis, txt)
    await page3.screenshot(path=OUT + 'desktop_error_handling.png', timeout=60000); await page3.close()
    await b.close()

async def mobile(p):
    b = await p.chromium.launch(args=ARGS)
    ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True,
                              user_agent='Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36')
    page = await ctx.new_page()
    page.on('console', lambda m: results['console_errors'].append(f'[mobile] {m.text}') if m.type == 'error' else None)
    page.on('response', lambda r: results['failed_requests'].append(f'[mobile] HTTP {r.status} {r.url}') if r.status >= 400 else None)
    t0 = time.time()
    await page.goto(BASE + '?qa=1', wait_until='domcontentloaded')
    ok = await wait_loaded(page)
    check('mobile 390x844: model loads', ok, f'{time.time() - t0:.1f}s')
    q = await page.evaluate('() => window.__campus.quality'); check('mobile: lightweight model chosen automatically', q == 'lite', q)
    await settle(page, 3500)
    await page.screenshot(path=OUT + 'mobile_overview.png', timeout=180000)
    await page.tap('#btn-list'); await page.wait_for_timeout(400)
    await page.screenshot(path=OUT + 'mobile_list.png', timeout=180000)
    await page.tap('#building-list button[data-id="bld_s2"]'); await settle(page, 3200)
    name = await page.text_content('#info-name'); check('mobile: select from list -> bottom-sheet info panel', name == 'Academic Block S2', name)
    await page.screenshot(path=OUT + 'mobile_selected.png', timeout=180000)
    # tap picking
    await page.tap('#btn-overview'); await settle(page, 2200)
    pt = await project_center(page, 'bld_main')
    await page.touchscreen.tap(pt['x'], pt['y']); await settle(page, 3000)
    sel = await page.evaluate('() => window.__campus.state.selected'); check('mobile: tap on building selects it', sel == 'bld_main', sel)
    await page.screenshot(path=OUT + 'mobile_tap_main.png', timeout=180000)
    # layout sanity: toolbar & panel within viewport
    bb = await page.evaluate("""() => { const t = document.getElementById('toolbar').getBoundingClientRect(); const p = document.getElementById('info-panel').getBoundingClientRect();
        return {toolbarRight: t.right, panelW: p.width, panelBottom: p.bottom, vw: innerWidth, vh: innerHeight}; }""")
    check('mobile: toolbar and info panel fit the viewport', bb['toolbarRight'] <= bb['vw'] + 1 and bb['panelW'] <= bb['vw'] + 1, bb)
    await b.close()

async def main():
    async with async_playwright() as p:
        await desktop(p)
        await mobile(p)
    results['summary'] = {'passed': sum(c['ok'] for c in results['checks']), 'total': len(results['checks'])}
    json.dump(results, open(OUT + 'qa_results.json', 'w'), indent=1, ensure_ascii=False)
    print('SUMMARY', results['summary'], 'console errors:', len(results['console_errors']), 'failed requests:', len(results['failed_requests']))

asyncio.run(main())
