// 3D Character Collision & Overhead Clearance Engine for EPNU Campus Guide.
// Keeps the visible articulated student (`walker.js`, H = 1.75 m) physically consistent with solid
// university architecture across walking, turning, doorway crossings, switchback stairs, landings,
// reverse descents, and high-speed / large-dt frame updates — without per-frame heap allocations.
import * as THREE from 'three';

export const CHAR_COLLIDER = {
  height: 1.75,           // standing head crown height matching walker.js SPEC.height
  radius: 0.27,           // horizontal capsule radius covering shoulders (±0.21m), arm swing (±0.25m) & backpack (-0.25m)
  stepUp: 0.30,           // max walkable step riser (~0.225m treads pass; >=0.42m furniture/rails/walls block)
  headSafetyMargin: 0.08, // required clearance margin below solid ceilings/slabs/lintels (m)
  maxSweepStep: 0.06,     // continuous sweep substep <= 6 cm (< 0.3 * WALL_T) — prevents wall tunneling at all speeds
  skin: 0.002,            // numerical push-out skin epsilon to eliminate floating-point re-entry jitter
};

const _tmpOut = { dx: 0, dz: 0, pen: 0, dist: 0 };

/**
 * Signed/unsigned horizontal distance and minimum push-out vector from world point (px, pz)
 * to a 2D oriented bounding box (cx, cz, hx, hz, cosA, sinA). Writes into `out` with zero allocations.
 */
function obbPushOut(px, pz, radius, b, out) {
  const rx = px - b.cx;
  const rz = pz - b.cz;
  // Transform (px, pz) into box local frame where X' = (cosA, -sinA), Z' = (sinA, cosA)
  const lx = rx * b.cos + rz * b.sin;
  const lz = -rx * b.sin + rz * b.cos;

  const qx = Math.max(-b.hx, Math.min(b.hx, lx));
  const qz = Math.max(-b.hz, Math.min(b.hz, lz));
  const dxL = lx - qx;
  const dzL = lz - qz;
  const d2 = dxL * dxL + dzL * dzL;

  if (d2 > 1e-12) {
    const d = Math.sqrt(d2);
    out.dist = d;
    if (d >= radius) {
      out.pen = 0;
      return false;
    }
    const pen = radius - d;
    const nxL = dxL / d;
    const nzL = dzL / d;
    out.dx = (nxL * b.cos - nzL * b.sin) * (pen + CHAR_COLLIDER.skin);
    out.dz = (nxL * b.sin + nzL * b.cos) * (pen + CHAR_COLLIDER.skin);
    out.pen = pen;
    return true;
  }

  // Center of character capsule actually crossed inside the OBB: push out along nearest face normal
  const penX = b.hx - Math.abs(lx);
  const penZ = b.hz - Math.abs(lz);
  let nxL = 0, nzL = 0, corePen = 0;
  if (penX <= penZ) {
    nxL = lx >= 0 ? 1 : -1;
    corePen = penX;
  } else {
    nzL = lz >= 0 ? 1 : -1;
    corePen = penZ;
  }
  const totalPen = radius + corePen;
  out.dist = -corePen;
  out.pen = totalPen;
  out.dx = (nxL * b.cos - nzL * b.sin) * (totalPen + CHAR_COLLIDER.skin);
  out.dz = (nxL * b.sin + nzL * b.cos) * (totalPen + CHAR_COLLIDER.skin);
  return true;
}

function pointInPoly2D(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi)) inside = !inside;
  }
  return inside;
}

function pointInRect(x, y, r) {
  return x > r[0] && x < r[2] && y > r[1] && y < r[3];
}

/**
 * Per-building 3D collision & overhead clearance world shared by `interior.js`, `route.js`, and `tour.js`.
 */
export function createCollisionWorld(footprint) {
  const obstaclesByFloor = [];
  const ceilingPlanes = [];  // { floorIndex, soffitY, slabTopY, holeRects }
  const slopedSoffits = [];  // { floorIndex, alongX, cross0, cross1, a0, a1, yAtA0, yAtA1, tag }

  function ensureFloor(fi) {
    while (obstaclesByFloor.length <= fi) obstaclesByFloor.push([]);
    return obstaclesByFloor[fi];
  }

  /** Registers a solid 3D oriented box on `floorIndex` (`y0`, `y1` in world Y metres). */
  function addSolidBox(floorIndex, cx, y0, y1, cz, sx, sz, angY = 0, tag = 'wall') {
    if (sx <= 0.005 || sz <= 0.005 || y1 - y0 <= 0.02) return;
    const hx = sx * 0.5, hz = sz * 0.5;
    ensureFloor(floorIndex).push({
      cx,
      cz,
      hx,
      hz,
      boundR: hx + hz,
      cos: Math.cos(-angY),
      sin: Math.sin(-angY),
      y0,
      y1,
      tag,
    });
  }

  /** Registers an axis-aligned solid box given local ENU plan center `(cx, cy)` and base/height on a floor. */
  function addPlanBox(floorIndex, levelY, cx, cy, h0, sx, sy, sz, tag = 'furniture') {
    addSolidBox(floorIndex, cx, levelY + h0, levelY + h0 + sz, -cy, sx, sy, 0, tag);
  }

  /** Registers a full-storey ceiling soffit + upper slab band `[soffitY, slabTopY]` with shaft/void cutouts. */
  function addCeilingSlab(floorIndex, soffitY, slabTopY, holeRects) {
    ceilingPlanes.push({
      floorIndex,
      soffitY,
      slabTopY,
      holeRects: holeRects.map((r) => [...r]),
    });
  }

  /** Registers the underside soffit of a staircase flight so headroom under upper flights is explicitly tracked. */
  function addStairSoffit(floorIndex, alongX, cross0, cross1, a0, a1, yAtA0, yAtA1) {
    slopedSoffits.push({
      floorIndex,
      alongX,
      cross0,
      cross1,
      minA: Math.min(a0, a1),
      maxA: Math.max(a0, a1),
      a0,
      a1,
      yAtA0,
      yAtA1,
    });
  }

  /**
   * Computes exact world-space overhead headroom at `(wx, footY, wz)`:
   *   `clearance = lowestOverheadSolidY - (footY + charHeight)`
   * Evaluates all floor ceilings, slabs, door lintels, and upper staircase stringer soffits.
   */
  function measureOverheadClearance(wx, footY, wz, charHeight = CHAR_COLLIDER.height) {
    const yPlan = -wz;
    const headY = footY + charHeight;
    let lowestY = Infinity;
    let lowestTag = 'sky';

    // 1. All floor ceilings & concrete floor slabs
    for (let i = 0; i < ceilingPlanes.length; i++) {
      const cp = ceilingPlanes[i];
      // A ceiling/slab is overhead if the character's feet are below the top of that slab
      if (footY >= cp.slabTopY - 0.04) continue;
      // Check if `(wx, yPlan)` lies cleanly inside an open shaft/void cutout of this ceiling
      let inHole = false;
      for (let h = 0; h < cp.holeRects.length; h++) {
        // Require character horizontal envelope (`radius * 0.75`) inside hole so head/shoulders don't strike slab rim
        const hr = cp.holeRects[h];
        const inset = 0.16;
        if (wx > hr[0] + inset && wx < hr[2] - inset && yPlan > hr[1] + inset && yPlan < hr[3] - inset) {
          inHole = true;
          break;
        }
      }
      if (!inHole && cp.soffitY < lowestY) {
        lowestY = cp.soffitY;
        lowestTag = `ceiling_${cp.floorIndex}`;
      }
    }

    // 2. Overhead door lintels & elevated beams across nearby floors
    for (let fi = 0; fi < obstaclesByFloor.length; fi++) {
      const list = obstaclesByFloor[fi];
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        // Overhead solid member whose underside is above knee height and whose base is above footY + 0.5m
        if (b.y0 <= footY + 0.60) continue;
        if (b.y0 >= lowestY) continue;
        if (obbPushOut(wx, wz, CHAR_COLLIDER.radius * 0.85, b, _tmpOut)) {
          lowestY = b.y0;
          lowestTag = b.tag;
        }
      }
    }

    // 3. Sloped concrete underside soffits of upper staircase flights
    for (let i = 0; i < slopedSoffits.length; i++) {
      const sf = slopedSoffits[i];
      const along = sf.alongX ? wx : yPlan;
      const cross = sf.alongX ? yPlan : wx;
      if (along < sf.minA - 0.15 || along > sf.maxA + 0.15) continue;
      if (cross < sf.cross0 - 0.15 || cross > sf.cross1 + 0.15) continue;
      const t = Math.max(0, Math.min(1, (along - sf.a0) / ((sf.a1 - sf.a0) || 1)));
      const soffitY = sf.yAtA0 + (sf.yAtA1 - sf.yAtA0) * t;
      if (soffitY > footY + 0.90 && soffitY < lowestY) {
        lowestY = soffitY;
        lowestTag = `stair_soffit_${sf.floorIndex}`;
      }
    }

    const clearance = lowestY === Infinity ? 99 : (lowestY - headY);
    return { clearance, lowestY, headY, tag: lowestTag };
  }

  /**
   * Exact horizontal surface clearance (in metres beyond zero-radius point, i.e. distance to nearest solid surface)
   * at plan coordinate `(x, yPlan)` and floor foot height `footY` on `floorIndex`.
   * Returns `< CHAR_COLLIDER.radius` if the character capsule would touch/penetrate an obstacle.
   */
  function horizontalSurfaceDistance(floorIndex, x, yPlan, footY) {
    // Exterior walls (`ext_wall`, thickness `EXT_T = 0.35m` with openings ONLY at entrances) are all
    // registered directly in `obstaclesByFloor`, avoiding false negatives on slightly tilted OSM edges.
    const wz = -yPlan;
    let minSurfaceDist = 99;
    const minF = Math.max(0, floorIndex - 1);
    const maxF = Math.min(obstaclesByFloor.length - 1, floorIndex + 1);
    for (let fi = minF; fi <= maxF; fi++) {
      const list = obstaclesByFloor[fi] || [];
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        if (footY + CHAR_COLLIDER.height <= b.y0 + 0.02) continue;
        if (footY + CHAR_COLLIDER.stepUp >= b.y1) continue;
        const rx = x - b.cx;
        if (rx > minSurfaceDist + b.boundR || -rx > minSurfaceDist + b.boundR) continue;
        const rz = wz - b.cz;
        if (rz > minSurfaceDist + b.boundR || -rz > minSurfaceDist + b.boundR) continue;
        const lx = rx * b.cos + rz * b.sin;
        const lz = -rx * b.sin + rz * b.cos;
        const qx = Math.max(-b.hx, Math.min(b.hx, lx));
        const qz = Math.max(-b.hz, Math.min(b.hz, lz));
        const dxL = lx - qx, dzL = lz - qz;
        const d2 = dxL * dxL + dzL * dzL;
        if (d2 > 1e-12) {
          const d = Math.sqrt(d2);
          if (d < minSurfaceDist) minSurfaceDist = d;
        } else {
          const pen = -Math.min(b.hx - Math.abs(lx), b.hz - Math.abs(lz));
          if (pen < minSurfaceDist) minSurfaceDist = pen;
        }
      }
    }
    return minSurfaceDist;
  }

  /**
   * Evaluates residual penetration at world position `(wx, wy, wz)` against ALL solid obstacles
   * without modifying position — used for independent audit & post-step telemetry assertions.
   */
  function auditPoint(wx, wy, wz, floorHint = 0) {
    let maxPen = 0;
    let minClear = 99;
    let worstTag = null;
    const minF = Math.max(0, floorHint - 1);
    const maxF = Math.min(obstaclesByFloor.length - 1, floorHint + 1);
    for (let fi = minF; fi <= maxF; fi++) {
      const list = obstaclesByFloor[fi] || [];
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        if (wy + CHAR_COLLIDER.height <= b.y0 + 0.02) continue;
        if (wy + CHAR_COLLIDER.stepUp >= b.y1) continue;
        if (obbPushOut(wx, wz, CHAR_COLLIDER.radius, b, _tmpOut)) {
          if (_tmpOut.pen > maxPen) {
            maxPen = _tmpOut.pen;
            worstTag = b.tag;
          }
          minClear = Math.min(minClear, -_tmpOut.pen);
        } else {
          minClear = Math.min(minClear, _tmpOut.dist - CHAR_COLLIDER.radius);
        }
      }
    }
    const oh = measureOverheadClearance(wx, wy, wz);
    return {
      maxPenetration: maxPen,
      minHorizontalClearance: minClear,
      worstObstacleTag: worstTag,
      overheadClearance: oh.clearance,
      overheadY: oh.lowestY,
      overheadTag: oh.tag,
    };
  }

  /**
   * Continuous Swept 3D Capsule Movement Resolver:
   * - Splits `fromPos -> intendedPos` into conservative `<= 6 cm` substeps (prevents wall tunneling at all speeds)
   * - Resolves solid walls, columns, door frames, stair walls, handrails, lift cores, balustrades & furniture via
   *   iterative multi-plane MTV push-out (preserving smooth tangential sliding parallel to angled walls & corners)
   * - Verifies overhead headroom against solid ceilings, concrete slabs, door lintels, and stair soffits BEFORE
   *   committing each substep.
   */
  function sweepMove(fromPos, intendedPos, outPos, floorHint = 0, stats = null) {
    const totalDx = intendedPos.x - fromPos.x;
    const totalDy = intendedPos.y - fromPos.y;
    const totalDz = intendedPos.z - fromPos.z;
    const dist = Math.hypot(totalDx, totalDy, totalDz);
    const steps = Math.max(1, Math.ceil(dist / CHAR_COLLIDER.maxSweepStep));

    let cx = fromPos.x;
    let cy = fromPos.y;
    let cz = fromPos.z;

    const minF = Math.max(0, floorHint - 1);
    const maxF = Math.min(obstaclesByFloor.length - 1, floorHint + 1);

    for (let s = 1; s <= steps; s++) {
      const prevX = cx, prevY = cy, prevZ = cz;
      cx += totalDx / steps;
      cy += totalDy / steps;
      cz += totalDz / steps;
      if (stats) stats.substeps++;

      // Iterative multi-plane horizontal capsule push-out (handles acute corners & narrow doorways cleanly)
      let hadSlide = false;
      for (let iter = 0; iter < 4; iter++) {
        let pushed = false;
        for (let fi = minF; fi <= maxF; fi++) {
          const list = obstaclesByFloor[fi] || [];
          for (let i = 0; i < list.length; i++) {
            const b = list[i];
            if (cy + CHAR_COLLIDER.height <= b.y0 + 0.02) continue;
            if (cy + CHAR_COLLIDER.stepUp >= b.y1) continue;
            if (stats) stats.queries++;
            if (obbPushOut(cx, cz, CHAR_COLLIDER.radius, b, _tmpOut)) {
              cx += _tmpOut.dx;
              cz += _tmpOut.dz;
              pushed = true;
              hadSlide = true;
              if (stats) {
                stats.wallContacts++;
                stats.lastBlockingTag = b.tag;
              }
            }
          }
        }
        if (!pushed) break;
      }
      if (hadSlide && stats) stats.wallSlides++;

      // Overhead ceiling / slab / lintel clearance check before accepting vertical / horizontal step
      const oh = measureOverheadClearance(cx, cy, cz);
      if (stats) {
        stats.ceilingChecks++;
        if (oh.clearance < stats.minOverheadClearance) {
          stats.minOverheadClearance = +oh.clearance.toFixed(3);
          stats.minOverheadPoint = [+cx.toFixed(2), +cy.toFixed(2), +(-cz).toFixed(2), oh.tag];
        }
      }
      if (oh.clearance < 0) {
        // Block entry into low-clearance overhead structure — revert to last valid collision-free pose
        cx = prevX;
        cy = prevY;
        cz = prevZ;
        if (stats) {
          stats.ceilingBlocks++;
          stats.lastBlockingTag = oh.tag;
        }
        break;
      }
    }

    outPos.set(cx, cy, cz);
    return outPos;
  }

  /**
   * Independent zero-allocation 3D camera-arm obstacle solver along `A(ax, ay, az) -> B(bx, by, bz)`:
   * Finds the earliest fractional hit `tHit in [0, 1]` where the camera sphere (`margin` m) meets ANY
   * solid wall, exterior wall, stair wall, column, lift core, door frame, or balustrade on nearby floors.
   * Completely independent of `sweepMove` (never moves or mutates the character collider!).
   */
  function raycastCameraArm(floorIndex, ax, ay, az, bx, by, bz, margin = 0.38) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const fullDist = Math.hypot(dx, dy, dz);
    if (fullDist < 1e-3) return null;
    const minF = Math.max(0, floorIndex - 1);
    const maxF = Math.min(obstaclesByFloor.length - 1, floorIndex + 1);
    const nSamples = Math.max(8, Math.ceil(fullDist / 0.14));
    for (let s = 1; s <= nSamples; s++) {
      const t = s / nSamples;
      const px = ax + dx * t;
      const py = ay + dy * t;
      const pz = az + dz * t;
      for (let fi = minF; fi <= maxF; fi++) {
        const list = obstaclesByFloor[fi] || [];
        for (let i = 0; i < list.length; i++) {
          const b = list[i];
          if (b.tag === 'furniture') continue;
          if (py < b.y0 - margin || py > b.y1 + margin) continue;
          const rx = px - b.cx;
          if (rx > margin + b.boundR || -rx > margin + b.boundR) continue;
          const rz = pz - b.cz;
          if (rz > margin + b.boundR || -rz > margin + b.boundR) continue;
          if (obbPushOut(px, pz, margin, b, _tmpOut)) {
            return Math.max(0, ((s - 1) / nSamples) * fullDist);
          }
        }
      }
    }
    return null;
  }

  return {
    obstaclesByFloor,
    ceilingPlanes,
    slopedSoffits,
    addSolidBox,
    addPlanBox,
    addCeilingSlab,
    addStairSoffit,
    measureOverheadClearance,
    horizontalSurfaceDistance,
    raycastCameraArm,
    auditPoint,
    sweepMove,
  };
}
