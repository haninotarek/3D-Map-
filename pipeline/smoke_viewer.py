"""Fast browser smoke test of the running web viewer (headless Chromium, SwiftShader WebGL).

Usage: python3 pipeline/smoke_viewer.py [base_url]
Writes analysis/restart_smoke/smoke_results.json + JPEG screenshots (does not touch deliverables/qa/).
"""
import asyncio, json, os, shutil, sys, time
from playwright.async_api import async_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8080/'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'analysis', 'restart_smoke', '')
os.makedirs(OUT, exist_ok=True)
EXPECTED = ['gate_1', 'bld_main', 'bld_w1', 'bld_w2', 'bld_s1', 'bld_s2', 'bld_s3', 'bld_e1', 'bld_e2',
            'bld_h1', 'bld_h2', 'lm_gazebo_garden', 'lm_sports_pitch']
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
        '--disable-dev-shm-usage', '--no-sandbox']
CHROMIUM = shutil.which('chromium') or shutil.which('google-chrome')
R = {'base': BASE, 'when': time.strftime('%Y-%m-%d %H:%M:%S'), 'checks': [], 'console_errors': [], 'failed_requests': []}


def check(name, ok, detail=''):
    R['checks'].append({'name': name, 'ok': bool(ok), 'detail': str(detail)[:300]})
    print(('PASS ' if ok else 'FAIL ') + name + (f' - {detail}' if detail != '' else ''), flush=True)


def watch(page, tag):
    page.on('console', lambda m: R['console_errors'].append(f'[{tag}] {m.text}') if m.type == 'error' else None)
    page.on('pageerror', lambda e: R['console_errors'].append(f'[{tag}] pageerror {e}'))
    page.on('requestfailed', lambda r: R['failed_requests'].append(f'[{tag}] {r.url} {r.failure}'))
    page.on('response', lambda r: R['failed_requests'].append(f'[{tag}] HTTP {r.status} {r.url}') if r.status >= 400 else None)


async def load(page, url):
    t0 = time.time()
    await page.goto(url, wait_until='domcontentloaded')
    await page.wait_for_function("() => document.getElementById('loading').classList.contains('hidden') || "
                                 "!document.getElementById('error').classList.contains('hidden')", timeout=240000)
    ok = await page.evaluate("() => document.getElementById('error').classList.contains('hidden')")
    return ok, time.time() - t0


async def settle(page):
    await page.wait_for_timeout(300)
    try:
        await page.wait_for_function("() => !window.__campus || window.__campus.state.anim === null", timeout=120000)
    except Exception:
        pass
    await page.wait_for_timeout(1200)


async def main():
    async with async_playwright() as p:
        launch_kw = {'args': ARGS}
        if CHROMIUM:
            launch_kw['executable_path'] = CHROMIUM
        b = await p.chromium.launch(**launch_kw)

        # Desktop, full-quality model
        ctx = await b.new_context(viewport={'width': 1440, 'height': 900}, device_scale_factor=1)
        page = await ctx.new_page(); watch(page, 'desktop')
        ok, dt = await load(page, BASE + '?quality=high&qa=1')
        check('desktop: full model loads, no error panel', ok, f'{dt:.1f}s')
        await settle(page)
        ids = await page.evaluate('() => window.__campus.items()')
        check('desktop: all 13 stable IDs registered', set(EXPECTED) <= set(ids), f'{len(ids)} items')
        check('desktop: quality = high', await page.evaluate('() => window.__campus.quality') == 'high')
        await page.screenshot(path=OUT + 'desktop_overview.jpg', type='jpeg', quality=85, timeout=180000)
        await page.evaluate("() => window.__campus.select('bld_main')")
        await settle(page)
        name = await page.text_content('#info-name')
        check('desktop: selection opens Main Building + info panel', name == 'Main Building', name)
        await page.screenshot(path=OUT + 'desktop_main_building.jpg', type='jpeg', quality=85, timeout=180000)
        await page.evaluate("() => window.__campus.overview()"); await settle(page)
        sel = await page.evaluate('() => window.__campus.state.selected')
        check('desktop: Overview button clears selection', sel is None, sel)
        await ctx.close()

        # Narrow mobile viewport -> auto lite model
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=1, is_mobile=True, has_touch=True)
        page = await ctx.new_page(); watch(page, 'mobile')
        ok, dt = await load(page, BASE + '?qa=1')
        check('mobile: lite model loads, no error panel', ok, f'{dt:.1f}s')
        await settle(page)
        check('mobile: quality auto-selected = lite', await page.evaluate('() => window.__campus.quality') == 'lite')
        ids = await page.evaluate('() => window.__campus.items()')
        check('mobile: all 13 stable IDs registered', set(EXPECTED) <= set(ids), f'{len(ids)} items')
        await page.screenshot(path=OUT + 'mobile_overview.jpg', type='jpeg', quality=85, timeout=180000)
        await ctx.close()
        await b.close()

    check('no console errors', not R['console_errors'], R['console_errors'][:5])
    check('no failed / 4xx-5xx requests', not R['failed_requests'], R['failed_requests'][:5])
    n_ok = sum(c['ok'] for c in R['checks'])
    R['summary'] = f'{n_ok}/{len(R["checks"])} PASS'
    json.dump(R, open(OUT + 'smoke_results.json', 'w'), indent=2, ensure_ascii=False)
    print(R['summary'])
    sys.exit(0 if n_ok == len(R['checks']) else 1)


asyncio.run(main())
