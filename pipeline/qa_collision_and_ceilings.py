"""Independent 3D Character Collision, Staircase Overhead Clearance, & Floor-by-Floor Ceiling Verification Suite.

Executes real-time WebGL browser trajectories across Group A (walls, sliding, corners, columns, door frames,
narrow corridors, railings), Group B (all staircases across both multi-storey engineering buildings), Group C
(continuous world-space overhead headroom in ascent & descent + low-ceiling guard), Group D (1x/1.5x/2x speeds,
pause/resume on stairs, stop/restart near wall, replay, reverse descent, extreme large-dt frame spikes, viewport
resizes), and Priority 4 (independent floor-by-floor ceiling geometry, opacity, normals, connections & cutouts
across all 4 occupied levels G, 1, 2, 3 in both bld_e2 and bld_e1), capturing 12 live rendered verification frames.
"""
import asyncio
import json
import os
import shutil
import sys
import time
from playwright.async_api import async_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8080/?qa=1'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'deliverables', 'qa', 'collision_ceilings')
os.makedirs(OUT, exist_ok=True)

CHROMIUM = shutil.which('chromium') or shutil.which('google-chrome')
ARGS = [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--disable-dev-shm-usage',
    '--no-sandbox',
]

REPORT = {
    'base': BASE,
    'timestamp': time.strftime('%Y-%m-%d %H:%M:%S'),
    'checks': [],
    'console_errors': [],
    'failed_requests': [],
    'telemetry_runs': {},
    'ceiling_audit': {},
}


def check(name, ok, detail=''):
    REPORT['checks'].append({'name': name, 'ok': bool(ok), 'detail': str(detail)[:400]})
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=CHROMIUM, args=ARGS)
        context = await browser.new_context(viewport={'width': 1280, 'height': 800})
        page = await context.new_page()

        page.on('console', lambda m: REPORT['console_errors'].append(m.text) if m.type == 'error' else None)
        page.on('pageerror', lambda e: REPORT['console_errors'].append(f'pageerror: {e}'))
        page.on('requestfailed', lambda r: REPORT['failed_requests'].append(f'{r.url} {r.failure}'))

        await page.goto(BASE, wait_until='domcontentloaded')
        await page.wait_for_function(
            "() => document.getElementById('loading').classList.contains('hidden')",
            timeout=180000,
        )
        # Hide schedule modal when taking clean architectural verification frames
        await page.evaluate("() => { const s = document.getElementById('sched'); if (s) s.style.display = 'none'; }")

        # Force load both multi-storey engineering interiors (`bld_e2` = Eng 1, `bld_e1` = Eng 2)
        init_meta = await page.evaluate("""async () => {
            await window.__campus.enterFloor('bld_e1', 0);
            await window.__campus.enterFloor('bld_e2', 0);
            window.__campus.exitInterior();
            const t = window.__campus.state.tour;
            const w = window.__campus.state.scene.getObjectByName('tour-walker');
            w.updateMatrixWorld(true);
            return {
                collider: t.collisionTelemetry.collider,
                e2Floors: window.__campus.state.interiors.get('bld_e2').floors.length,
                e1Floors: window.__campus.state.interiors.get('bld_e1').floors.length,
                e2ObstaclesPerFloor: window.__campus.state.interiors.get('bld_e2').collisionWorld.obstaclesByFloor.map(x => x.length),
                e1ObstaclesPerFloor: window.__campus.state.interiors.get('bld_e1').collisionWorld.obstaclesByFloor.map(x => x.length),
            };
        }""")
        check(
            'T01_character_collider_matches_student_rig',
            abs(init_meta['collider']['height'] - 1.75) < 1e-6
            and 0.24 <= init_meta['collider']['radius'] <= 0.32
            and init_meta['collider']['maxSweepStep'] <= 0.08,
            f"collider={init_meta['collider']}",
        )
        check(
            'T02_world_obstacles_registered_on_all_floors',
            init_meta['e2Floors'] == 4 and init_meta['e1Floors'] == 4
            and all(n > 50 for n in init_meta['e2ObstaclesPerFloor'])
            and all(n > 40 for n in init_meta['e1ObstaclesPerFloor']),
            f"bld_e2={init_meta['e2ObstaclesPerFloor']}, bld_e1={init_meta['e1ObstaclesPerFloor']}",
        )

        # ==============================================================================
        # PRIORITY 4 — INDEPENDENT FLOOR-BY-FLOOR CEILING AUDIT (`bld_e2` & `bld_e1`)
        # ==============================================================================
        ceiling_audit = await page.evaluate("""() => {
            const out = {};
            for (const bldId of ['bld_e2', 'bld_e1']) {
                const interior = window.__campus.state.interiors.get(bldId);
                // Put interior in full 4-storey eye-level walkthrough mode (`setVisibleFloors(3, 0)`)
                interior.group.visible = true;
                interior.setVisibleFloors(interior.floors.length - 1, 0);
                interior.syncCameraCutaway(1.6, true);
                interior.group.updateMatrixWorld(true);

                out[bldId] = {
                    buildingNameEn: interior.data.name_en,
                    totalFloors: interior.floors.length,
                    ceilingPlanesRegistered: interior.collisionWorld.ceilingPlanes.length,
                    soffitsRegistered: interior.collisionWorld.slopedSoffits.length,
                    floors: interior.floors.map((fl, fi) => {
                        const c = fl.ceiling;
                        c.geometry.computeBoundingBox();
                        const bb = c.geometry.boundingBox;
                        const thickness = +(bb.max.y - bb.min.y).toFixed(4);
                        const worldSoffitY = +(fl.level + fl.clearH + bb.min.y).toFixed(3);
                        const mat = c.material;
                        const cp = interior.collisionWorld.ceilingPlanes.find(p => p.floorIndex === fi);
                        return {
                            index: fi,
                            id: fl.id,
                            nameEn: fl.name_en,
                            levelY: fl.level,
                            clearH: fl.clearH,
                            worldSoffitY,
                            slabTopAboveY: cp ? cp.slabTopY : null,
                            meshExists: Boolean(c && c.isMesh),
                            groupVisibleEyeLevel: fl.group.visible,
                            ceilingVisibleEyeLevel: c.visible,
                            solidThicknessM: thickness,
                            spanX: +(bb.max.x - bb.min.x).toFixed(2),
                            spanZ: +(bb.max.z - bb.min.z).toFixed(2),
                            opaque: !mat.transparent && mat.opacity === 1,
                            doubleSided: mat.side === 2, // THREE.DoubleSide === 2
                            holeCount: fl.ceilingHoleRects.length,
                            registeredInCollider: Boolean(cp && Math.abs(cp.soffitY - (fl.level + fl.clearH)) < 1e-3),
                        };
                    }),
                };
            }
            return out;
        }""")
        REPORT['ceiling_audit'] = ceiling_audit

        for bld_id, bdata in ceiling_audit.items():
            check(
                f'P4_{bld_id}_exact_4_occupied_floors_G_1_2_3',
                [f['id'] for f in bdata['floors']] == ['G', '1', '2', '3'] and bdata['ceilingPlanesRegistered'] == 4,
                f"floors={[f['id'] for f in bdata['floors']]}, ceilingPlanes={bdata['ceilingPlanesRegistered']}",
            )
            for fl in bdata['floors']:
                ok = (
                    fl['meshExists']
                    and fl['groupVisibleEyeLevel']
                    and fl['ceilingVisibleEyeLevel']
                    and abs(fl['solidThicknessM'] - 0.04) < 0.005
                    and fl['opaque']
                    and fl['doubleSided']
                    and fl['spanX'] > 40.0
                    and fl['spanZ'] > 20.0
                    and fl['registeredInCollider']
                    and (fl['holeCount'] == 0 if fl['id'] == '3' else fl['holeCount'] >= 2)
                )
                check(
                    f"P4_{bld_id}_floor_{fl['id']}_ceiling_complete_opaque_connected",
                    ok,
                    f"level={fl['levelY']}m soffit={fl['worldSoffitY']}m thick={fl['solidThicknessM']}m "
                    f"span={fl['spanX']}x{fl['spanZ']}m holes={fl['holeCount']} opaque={fl['opaque']} doubleSide={fl['doubleSided']}",
                )

        # ==============================================================================
        # GROUP A — ADVERSARIAL WALL, SLIDE, CORNER, DOOR FRAME, COLUMN & RAILING TESTS
        # ==============================================================================
        group_a = await page.evaluate("""() => {
            const t = window.__campus.state.tour;
            const e2 = window.__campus.state.interiors.get('bld_e2');
            const y0 = e2.floors[0].level + 0.012;
            const y1 = e2.floors[1].level + 0.012;

            // A1: Direct perpendicular push into solid stair east wall (`x = 158.0, yPlan = -77.0` south of doorway)
            const a1 = t.probeMove([159.40, y0, 77.00], [156.50, y0, 77.00], 0, 'bld_e2');

            // A2: Angled 35-deg slide along corridor wall (`x = 158.0`, moving south from `-76.2` to `-78.0` while pushing west)
            const a2 = t.probeMove([158.42, y0, 76.10], [157.10, y0, 78.10], 0, 'bld_e2');

            // A3: Acute 90-deg corner push + clean recovery back into open corridor
            const cornerIn = t.probeMove([159.20, y0, 69.20], [157.40, y0, 70.60], 0, 'bld_e2');
            const cornerOut = t.probeMove(cornerIn.resolved, [159.20, y0, 69.20], 0, 'bld_e2');

            // A4: Open 1.60m stairwell doorway (`mid = -74.10`: unobstructed) vs adjacent jamb (`-75.25`: blocked!)
            const doorPass = t.probeMove([159.20, y0, 74.10], [156.90, y0, 74.10], 0, 'bld_e2');
            const doorJambBlock = t.probeMove([159.20, y0, 75.25], [156.90, y0, 75.25], 0, 'bld_e2');

            // A5: Structural 0.42m reinforced-concrete atrium column block (`spine = [160.3, -70.0, 176.2, -55.0]` -> col `[160.65, -69.65]`)
            const colHit = t.probeMove([162.00, y0, 69.65], [159.80, y0, 69.65], 0, 'bld_e2');

            // A6: Floor 1 East Gallery Atrium Glass Balustrade (`void_c` east rail at `x = 171.20`, `yPlan = -62.5`)
            const railHit = t.probeMove([173.00, y1, 62.50], [170.00, y1, 62.50], 1, 'bld_e2');

            // C_GUARD: Low-ceiling overhead penetration guard (`y -> ceilY - 1.20` where `headY > soffitY` outside hole)
            const ceilGuard = t.probeMove([161.20, 2.80, 62.50], [161.20, 3.60, 62.50], 0, 'bld_e2');

            return { a1, a2, cornerIn, cornerOut, doorPass, doorJambBlock, colHit, railHit, ceilGuard };
        }""")
        REPORT['telemetry_runs']['group_a_adversarial'] = group_a

        check(
            'GA_01_direct_perpendicular_wall_stop',
            group_a['a1']['resolved'][0] >= 158.35
            and group_a['a1']['stats']['wallContacts'] > 0
            and group_a['a1']['audit']['maxPenetration'] <= 1e-3,
            f"resolvedX={group_a['a1']['resolved'][0]} contacts={group_a['a1']['stats']['wallContacts']} pen={group_a['a1']['audit']['maxPenetration']}",
        )
        check(
            'GA_02_parallel_wall_sliding_smooth_no_penetration',
            group_a['a2']['resolved'][0] >= 158.35
            and (group_a['a2']['resolved'][2] - 76.10) >= 1.20
            and group_a['a2']['stats']['wallSlides'] > 0
            and group_a['a2']['audit']['maxPenetration'] <= 1e-3,
            f"resolved={group_a['a2']['resolved']} slidZ={round(group_a['a2']['resolved'][2] - 76.10, 3)}m pen={group_a['a2']['audit']['maxPenetration']}",
        )
        check(
            'GA_03_acute_corner_block_and_clean_recovery',
            group_a['cornerIn']['audit']['maxPenetration'] <= 1e-3
            and abs(group_a['cornerOut']['resolved'][0] - 159.20) < 0.05
            and abs(group_a['cornerOut']['resolved'][2] - 69.20) < 0.05
            and group_a['cornerOut']['audit']['maxPenetration'] <= 1e-3,
            f"cornerIn={group_a['cornerIn']['resolved']} recoveredTo={group_a['cornerOut']['resolved']}",
        )
        check(
            'GA_04_open_doorway_unobstructed_vs_adjacent_jamb_blocked',
            abs(group_a['doorPass']['resolved'][0] - 156.90) < 0.02
            and group_a['doorPass']['stats']['wallContacts'] == 0
            and group_a['doorJambBlock']['resolved'][0] >= 158.35
            and group_a['doorJambBlock']['stats']['wallContacts'] > 0,
            f"openDoorX={group_a['doorPass']['resolved'][0]} jambBlockedX={group_a['doorJambBlock']['resolved'][0]}",
        )
        check(
            'GA_05_structural_column_blocks_penetration',
            group_a['colHit']['stats']['wallContacts'] > 0
            and group_a['colHit']['resolved'][0] > 161.05
            and group_a['colHit']['audit']['maxPenetration'] <= 1e-3,
            f"colResolved={group_a['colHit']['resolved']} tag={group_a['colHit']['stats']['lastBlockingTag']}",
        )
        check(
            'GA_06_atrium_balustrade_railing_blocks_fall',
            group_a['railHit']['stats']['wallContacts'] > 0
            and group_a['railHit']['resolved'][0] > 171.45
            and group_a['railHit']['stats']['lastBlockingTag'] == 'railing',
            f"railResolved={group_a['railHit']['resolved']} tag={group_a['railHit']['stats']['lastBlockingTag']}",
        )
        check(
            'GC_01_overhead_ceiling_guard_blocks_head_penetration',
            group_a['ceilGuard']['stats']['ceilingBlocks'] > 0
            and group_a['ceilGuard']['audit']['overheadClearance'] >= 0.0,
            f"ceilGuardResolvedY={group_a['ceilGuard']['resolved'][1]} minClearance={group_a['ceilGuard']['audit']['overheadClearance']}m",
        )

        # ==============================================================================
        # GROUPS B & C — ALL STAIRCASES, ALL 4 FLOORS, ASCENT & REVERSE DESCENT IN BOTH BUILDINGS
        # ==============================================================================
        routes_matrix = await page.evaluate("""async () => {
            // Find valid upper-floor north & south rooms in BOTH `bld_e2` and `bld_e1` dynamically from roomIndex
            const e2TopSouth = { building: 'Engineering Building 1', room: 'Hall 3', lang: 'ar', roomLabel: 'قاعة 3' };
            const e2TopNorth = { building: 'Engineering Building 1', room: 'Hall 4', lang: 'ar', roomLabel: 'قاعة 4' };
            const e1Data = window.__campus.state.interiors.get('bld_e1').data;
            const e1F3Rooms = e1Data.floors[3].rooms.filter(r => r.door && !r.open && r.kind !== 'stair' && r.kind !== 'lift' && r.kind !== 'void' && r.kind !== 'wc');
            const e1SouthRoom = e1F3Rooms.reduce((a, b) => (a.rect[1] < b.rect[1] ? a : b));
            const e1NorthRoom = e1F3Rooms.reduce((a, b) => (a.rect[1] > b.rect[1] ? a : b));
            const e2GroundRoom = window.__campus.state.interiors.get('bld_e2').data.floors[0].rooms.find(r => r.kind === 'lab' && r.door);

            const scenarios = [
                ['B1_e2_south_stairs_G_to_3_ascent', e2TopSouth],
                ['B2_e2_north_stairs_G_to_3_ascent', e2TopNorth],
                ['B3_e1_south_stairs_G_to_3_ascent', { building: 'Engineering Building 2', room: e1SouthRoom.name_en, lang: 'ar' }],
                ['B4_e1_north_stairs_G_to_3_ascent', { building: 'Engineering Building 2', room: e1NorthRoom.name_en, lang: 'ar' }],
                ['A7_e2_ground_lab_arrival', { building: 'Engineering Building 1', room: e2GroundRoom.name_en, lang: 'ar' }],
                ['C2_e2_south_stairs_3_to_G_descent', { ...e2TopSouth, reverse: true }],
                ['C3_e1_north_stairs_3_to_G_descent', { building: 'Engineering Building 2', room: e1NorthRoom.name_en, lang: 'ar', reverse: true }],
            ];

            const results = {};
            for (const [key, req] of scenarios) {
                await window.__campus.showRoute(req);
                const t = window.__campus.state.tour;
                const w = window.__campus.state.scene.getObjectByName('tour-walker');
                const interior = window.__campus.state.interiors.get(window.__campus.route().buildingId);
                let frames = 0;
                let minStairHeadroom = 99;
                while (frames < 5000 && t.state !== 'ARRIVED') {
                    t.update(1 / 30);
                    frames++;
                    if (t.state === 'CLIMBING' || t.state === 'DESCENDING') {
                        if (interior) {
                            const oh = interior.collisionWorld.measureOverheadClearance(w.position.x, w.position.y, w.position.z);
                            if (oh.clearance < minStairHeadroom) minStairHeadroom = +oh.clearance.toFixed(3);
                        }
                    }
                }
                results[key] = {
                    frames,
                    state: t.state,
                    finalFloor: t.currentFloor,
                    floorTransitions: [...t.telemetry.floorTransitions],
                    maxIndoorPitchDeg: +t.telemetry.maxIndoorPitchDeg.toFixed(2),
                    minStairHeadroomM: minStairHeadroom,
                    collision: JSON.parse(JSON.stringify(t.collisionTelemetry)),
                };
            }
            return results;
        }""")
        REPORT['telemetry_runs']['groups_b_c_routes'] = routes_matrix

        for key, r in routes_matrix.items():
            c = r['collision']
            expected_floors = (
                [3, 2, 1, 0, -1] if 'descent' in key
                else ([-1, 0] if 'ground_lab' in key else [-1, 0, 1, 2, 3])
            )
            stair_ok = True if 'ground_lab' in key else (r['minStairHeadroomM'] >= 1.80)
            check(
                f'GBC_{key}',
                r['state'] == 'ARRIVED'
                and r['floorTransitions'] == expected_floors
                and c['maxPenetrationDepth'] == 0
                and c['ceilingBlocks'] == 0
                and c['minOverheadClearance'] >= 0.45
                and stair_ok
                and r['maxIndoorPitchDeg'] <= 12.0,
                f"floors={r['floorTransitions']} maxPen={c['maxPenetrationDepth']}m "
                f"minStairHeadroom=+{r['minStairHeadroomM']}m minDoorClear=+{c['minOverheadClearance']}m pitch={r['maxIndoorPitchDeg']}deg",
            )

        # ==============================================================================
        # GROUP D — MULTI-SPEED (`1x`, `1.5x`, `2x`), PAUSE/RESUME ON STAIRS, REPLAY,
        # LARGE `dt` SPIKES (`dt = 0.25s` & `0.50s` @ `2x`), AND VIEWPORT RESIZES
        # ==============================================================================
        group_d = await page.evaluate("""async () => {
            const out = {};
            const baseReq = { building: 'Engineering Building 1', room: 'Hall 3', lang: 'ar', roomLabel: 'قاعة 3' };

            // D1: 1.0x, 1.5x, 2.0x speed parity
            for (const rate of [1.0, 1.5, 2.0]) {
                await window.__campus.showRoute(baseReq);
                const t = window.__campus.state.tour;
                t.setPlaybackRate(rate);
                let n = 0;
                while (n < 5000 && t.state !== 'ARRIVED') { t.update(1 / 30); n++; }
                out[`rate_${rate}x`] = {
                    frames: n,
                    floors: [...t.telemetry.floorTransitions],
                    maxPen: t.collisionTelemetry.maxPenetrationDepth,
                    minOverhead: t.collisionTelemetry.minOverheadClearance,
                };
            }
            window.__campus.state.tour.setPlaybackRate(1.0);

            // D2: Pause & Resume mid-staircase + Replay from scratch
            await window.__campus.showRoute(baseReq);
            const t = window.__campus.state.tour;
            while (t.state !== 'CLIMBING') t.update(1 / 30);
            for (let i = 0; i < 20; i++) t.update(1 / 30);
            t.toggle(); // pause on stairs
            const pausedPos = window.__campus.state.scene.getObjectByName('tour-walker').position.clone();
            for (let i = 0; i < 15; i++) t.update(1 / 30);
            const afterPausePos = window.__campus.state.scene.getObjectByName('tour-walker').position.clone();
            t.toggle(); // resume on stairs
            let rem = 0;
            while (rem < 5000 && t.state !== 'ARRIVED') { t.update(1 / 30); rem++; }
            out.pauseResumeStairs = {
                driftWhilePaused: +pausedPos.distanceTo(afterPausePos).toFixed(6),
                arrivedAfterResume: t.state === 'ARRIVED',
                maxPen: t.collisionTelemetry.maxPenetrationDepth,
            };

            // Replay integrity
            t.replay();
            let rep = 0;
            while (rep < 5000 && t.state !== 'ARRIVED') { t.update(1 / 30); rep++; }
            out.replayRun = {
                floors: [...t.telemetry.floorTransitions],
                maxPen: t.collisionTelemetry.maxPenetrationDepth,
                minOverhead: t.collisionTelemetry.minOverheadClearance,
            };

            // D3: Severe frame-time hitch (`dt = 0.35s` and `dt = 0.50s` at `2.0x` = 1.0s per update!)
            await window.__campus.showRoute(baseReq);
            t.setPlaybackRate(2.0);
            let spikes = 0;
            while (spikes < 600 && t.state !== 'ARRIVED') {
                t.update(spikes % 2 === 0 ? 0.35 : 0.50);
                spikes++;
            }
            out.extremeDtSpike = {
                updates: spikes,
                state: t.state,
                floors: [...t.telemetry.floorTransitions],
                substeps: t.collisionTelemetry.substeps,
                maxPen: t.collisionTelemetry.maxPenetrationDepth,
                ceilingBlocks: t.collisionTelemetry.ceilingBlocks,
                minOverhead: t.collisionTelemetry.minOverheadClearance,
            };
            t.setPlaybackRate(1.0);
            return out;
        }""")
        REPORT['telemetry_runs']['group_d_stress'] = group_d

        check(
            'GD_01_speed_1x_1_5x_2x_zero_tunneling_monotonic_scaling',
            group_d['rate_1x']['floors'] == [-1, 0, 1, 2, 3]
            and group_d['rate_1.5x']['floors'] == [-1, 0, 1, 2, 3]
            and group_d['rate_2x']['floors'] == [-1, 0, 1, 2, 3]
            and group_d['rate_1x']['frames'] > group_d['rate_1.5x']['frames'] > group_d['rate_2x']['frames']
            and max(group_d['rate_1x']['maxPen'], group_d['rate_1.5x']['maxPen'], group_d['rate_2x']['maxPen']) == 0,
            f"frames: 1x={group_d['rate_1x']['frames']}, 1.5x={group_d['rate_1.5x']['frames']}, 2x={group_d['rate_2x']['frames']}",
        )
        check(
            'GD_02_pause_resume_on_stairs_and_full_replay',
            group_d['pauseResumeStairs']['driftWhilePaused'] == 0.0
            and group_d['pauseResumeStairs']['arrivedAfterResume']
            and group_d['replayRun']['floors'] == [-1, 0, 1, 2, 3]
            and group_d['replayRun']['maxPen'] == 0,
            f"pauseResume={group_d['pauseResumeStairs']}, replay={group_d['replayRun']}",
        )
        check(
            'GD_03_extreme_dt_spike_0_50s_at_2x_zero_wall_or_ceiling_tunneling',
            group_d['extremeDtSpike']['state'] == 'ARRIVED'
            and group_d['extremeDtSpike']['floors'] == [-1, 0, 1, 2, 3]
            and group_d['extremeDtSpike']['maxPen'] == 0
            and group_d['extremeDtSpike']['ceilingBlocks'] == 0
            and group_d['extremeDtSpike']['minOverhead'] >= 0.45,
            f"spike={group_d['extremeDtSpike']}",
        )

        # D4: Responsive viewport resize during active indoor navigation
        await page.set_viewport_size({'width': 390, 'height': 844})
        await page.evaluate("""async () => {
            await window.__campus.showRoute({ building: 'Engineering Building 1', room: 'Hall 3', lang: 'ar', roomLabel: 'قاعة 3' });
            const t = window.__campus.state.tour;
            while (t.state !== 'CLIMBING') t.update(1 / 30);
        }""")
        await page.set_viewport_size({'width': 1280, 'height': 800})
        resize_ok = await page.evaluate("""() => {
            const t = window.__campus.state.tour;
            while (t.state !== 'ARRIVED') t.update(1 / 30);
            return { arrived: t.state === 'ARRIVED', maxPen: t.collisionTelemetry.maxPenetrationDepth };
        }""")
        check(
            'GD_04_responsive_viewport_resize_during_active_navigation',
            resize_ok['arrived'] and resize_ok['maxPen'] == 0,
            f"{resize_ok}",
        )

        # ==============================================================================
        # VISUAL VERIFICATION CAPTURES (ALL 8 MANDATORY COLLISION SHOTS + 4 FLOOR CEILING SHOTS)
        # ==============================================================================
        async def render_shot(filename):
            await page.evaluate("""() => {
                const s = window.__campus.state;
                if (s.inside) s.interiors.get(s.inside.id)?.syncCameraCutaway?.(s.camera.position.y, true);
                s.renderer.render(s.scene, s.camera);
                s.labelRenderer.render(s.scene, s.camera);
            }""")
            await page.screenshot(path=os.path.join(OUT, filename))
            print(f'Saved visual proof: {filename}', flush=True)

        # Helper to advance `Hall 3` tour cleanly to exact semantic states & capture real camera frames
        await page.evaluate("""async () => {
            await window.__campus.showRoute({ building: 'Engineering Building 1', room: 'Hall 3', lang: 'ar', roomLabel: 'قاعة 3' });
        }""")

        # Shot 08: Gate No. 1 open inbound carriageway arch (replacing pier collision in baseline_02!)
        await page.evaluate("""() => {
            const s = window.__campus.state;
            s.tour.replay();
            const w = s.scene.getObjectByName('tour-walker');
            while (w.position.x < -210) s.tour.update(1 / 30);
            s.camera.position.set(w.position.x - 10.5, 2.6, w.position.z - 2.0);
            s.camera.lookAt(w.position.x + 12.0, 2.4, w.position.z);
        }""")
        await render_shot('08_gate1_open_carriageway_arch.png')

        # Shot 01: Character walking & sliding cleanly alongside west atrium wall (`x = 160.30`) with visible physical clearance gap
        await page.evaluate("""() => {
            const s = window.__campus.state;
            const e2 = s.interiors.get('bld_e2');
            const y0 = e2.floors[0].level + 0.012;
            s.tour.replay();
            while (s.tour.currentFloor !== 0) s.tour.update(1 / 30);
            s.tour.probeMove([161.35, y0, 57.50], [160.10, y0, 60.20], 0, 'bld_e2');
            const w = s.scene.getObjectByName('tour-walker');
            s.camera.position.set(163.40, y0 + 1.45, 56.80);
            s.controls.target.set(w.position.x - 0.10, y0 + 1.05, w.position.z + 0.15);
            s.camera.lookAt(s.controls.target);
        }""")
        await render_shot('01_character_near_wall_sliding.png')

        # Shot 02: Character passing squarely through open double oak doorway under 2.25m transom
        await page.evaluate("""() => {
            const s = window.__campus.state;
            s.tour.replay();
            while (s.tour.state !== 'ARRIVED') s.tour.update(1 / 30);
            const w = s.scene.getObjectByName('tour-walker');
            // Back up slightly to threshold of Hall 3 doorway
            const e2 = s.interiors.get('bld_e2');
            const y3 = e2.floors[3].level + 0.012;
            w.position.set(174.55, y3, 82.30);
            w.rotation.y = Math.PI * 0.5;
            s.tour.walkerFigure.update(0.12, { speed: 2.0, isStair: false, headingDelta: 0 });
            s.camera.position.set(171.60, y3 + 1.58, 82.65);
            s.camera.lookAt(175.80, y3 + 1.28, 82.30);
        }""")
        await render_shot('02_character_passing_open_doorway.png')

        # Shot 03: Character climbing lower concrete stair flight (`laneA`)
        await page.evaluate("""() => {
            const s = window.__campus.state;
            s.tour.replay();
            while (s.tour.state !== 'CLIMBING') s.tour.update(1 / 30);
            for (let i = 0; i < 28; i++) s.tour.update(1 / 30);
            const w = s.scene.getObjectByName('tour-walker');
            s.camera.position.set(w.position.x + 2.35, w.position.y + 1.45, w.position.z - 0.55);
            s.camera.lookAt(w.position.x - 1.2, w.position.y + 1.05, w.position.z);
        }""")
        await render_shot('03_stair_climb_lower_flight.png')

        # Shot 04: Character turning cleanly on West Half-Landing inside open 4-storey stairwell shaft
        await page.evaluate("""() => {
            const s = window.__campus.state;
            const w = s.scene.getObjectByName('tour-walker');
            while (w.position.x > 149.2) s.tour.update(1 / 30);
            for (let i = 0; i < 6; i++) s.tour.update(1 / 30);
            s.camera.position.set(w.position.x + 3.1, w.position.y + 1.55, w.position.z - 1.45);
            s.camera.lookAt(w.position.x, w.position.y + 1.05, w.position.z + 0.25);
        }""")
        await render_shot('04_stair_climb_switchback_half_landing.png')

        # Shot 05: Character climbing upper stair flight (`laneB`) showing full +2.00m+ overhead headroom & clean slab cutout!
        await page.evaluate("""() => {
            const s = window.__campus.state;
            const w = s.scene.getObjectByName('tour-walker');
            while (w.position.y < 4.55) s.tour.update(1 / 30);
            s.camera.position.set(w.position.x - 2.65, w.position.y + 1.15, w.position.z + 0.45);
            s.camera.lookAt(w.position.x + 1.35, w.position.y + 1.15, w.position.z - 0.15);
        }""")
        await render_shot('05_stair_climb_upper_flight_headroom.png')

        # Shot 06: Character exiting stairs orthogonally onto upper floor corridor through 1.60m open fire doorway
        await page.evaluate("""() => {
            const s = window.__campus.state;
            while (s.tour.currentFloor < 3) s.tour.update(1 / 30);
            for (let i = 0; i < 20; i++) s.tour.update(1 / 30);
            const w = s.scene.getObjectByName('tour-walker');
            s.camera.position.set(w.position.x + 2.85, w.position.y + 1.56, w.position.z + 0.55);
            s.camera.lookAt(w.position.x - 0.8, w.position.y + 1.18, w.position.z);
        }""")
        await render_shot('06_stair_exit_upper_landing_doorway.png')

        # Shot 07: Character descending stairs in reverse route mode (`3 -> 2 -> 1 -> G`)
        await page.evaluate("""async () => {
            await window.__campus.showRoute({ building: 'Engineering Building 1', room: 'Hall 3', lang: 'ar', roomLabel: 'قاعة 3', reverse: true });
            const s = window.__campus.state;
            while (s.tour.state !== 'CLIMBING' && s.tour.state !== 'DESCENDING') s.tour.update(1 / 30);
            for (let i = 0; i < 32; i++) s.tour.update(1 / 30);
            const w = s.scene.getObjectByName('tour-walker');
            s.camera.position.set(w.position.x - 2.55, w.position.y + 1.35, w.position.z - 0.45);
            s.camera.lookAt(w.position.x + 1.0, w.position.y + 0.95, w.position.z);
        }""")
        await render_shot('07_stair_descent_reverse_walk.png')

        # Shots 09..12: Floor-by-Floor Interior Ceiling Verification (`G`, `1`, `2`, `3`)
        floor_cam_specs = [
            ('09_ceiling_floor_G_atrium_and_corridor.png', 0, [160.8, 2.25, 69.2], [168.5, 4.15, 62.5]),
            ('10_ceiling_floor_1_gallery_and_corridor.png', 1, [160.6, 6.72, 69.8], [168.5, 7.65, 62.5]),
            ('11_ceiling_floor_2_corridor_and_labs.png',    2, [160.6, 10.72, 68.5], [160.8, 11.45, 56.0]),
            ('12_ceiling_floor_3_top_storey_sealed.png',    3, [160.6, 14.72, 76.0], [161.2, 15.40, 62.0]),
        ]
        for fname, fidx, cpos, clook in floor_cam_specs:
            await page.evaluate(f"""async () => {{
                window.__campus.clearRoute();
                await window.__campus.enterFloor('bld_e2', {fidx});
                const s = window.__campus.state;
                s.anim = null;
                s.interiors.get('bld_e2').setVisibleFloors(3, {fidx});
                s.camera.position.set({cpos[0]}, {cpos[1]}, {cpos[2]});
                s.controls.target.set({clook[0]}, {clook[1]}, {clook[2]});
                s.camera.lookAt({clook[0]}, {clook[1]}, {clook[2]});
            }}""")
            await render_shot(fname)

        check(
            'Z01_zero_browser_console_or_network_errors',
            len(REPORT['console_errors']) == 0 and len(REPORT['failed_requests']) == 0,
            f"console_errors={REPORT['console_errors']} failed_requests={REPORT['failed_requests']}",
        )

        json.dump(REPORT, open(os.path.join(OUT, 'qa_collision_and_ceilings_results.json'), 'w'), indent=2)
        await browser.close()

    passed = sum(1 for c in REPORT['checks'] if c['ok'])
    total = len(REPORT['checks'])
    print(f'\nSUMMARY: {passed}/{total} checks PASSED')
    if passed != total:
        sys.exit(1)


if __name__ == '__main__':
    asyncio.run(main())
