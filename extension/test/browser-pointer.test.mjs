import test from 'node:test';
import assert from 'node:assert/strict';
import { executeFramePointer, projectFramePoint, unprojectFramePoint } from '../background/browser-pointer.js';
import { clearBrowserFrames, recordBrowserFrameEvent } from '../background/browser-frames.js';
test('frame projection accounts for content borders, scale, rotation and nested frames', () => {
    const scaled = projectFramePoint({ x: 40, y: 20 }, { width: 200, height: 100 }, [12, 24, 112, 24, 112, 74, 12, 74]);
    assert.deepEqual(scaled, { x: 32, y: 34 });
    const rotated = projectFramePoint({ x: 25, y: 50 }, { width: 100, height: 100 }, [100, 0, 100, 100, 0, 100, 0, 0]);
    assert.deepEqual(rotated, { x: 50, y: 25 });
    assert.deepEqual(projectFramePoint(rotated, { width: 200, height: 100 }, [20, 40, 420, 40, 420, 240, 20, 240]), { x: 120, y: 90 });
});
test('perspective projection uses the projective center, not an axis-aligned or bilinear center', () => {
    const point = projectFramePoint({ x: 50, y: 50 }, { width: 100, height: 100 }, [0, 0, 100, 0, 80, 100, 20, 100]);
    assert.ok(Math.abs(point.x - 50) < 1e-9);
    assert.ok(Math.abs(point.y - 62.5) < 1e-9);
    for (const [point, expected] of [[{ x: 0, y: 0 }, { x: 0, y: 0 }], [{ x: 100, y: 100 }, { x: 80, y: 100 }]]) {
        const result = projectFramePoint(point, { width: 100, height: 100 }, [0, 0, 100, 0, 80, 100, 20, 100]);
        assert.ok(Math.hypot(result.x - expected.x, result.y - expected.y) < 1e-9);
    }
});
test('same-process viewport inversion round-trips scale, rotation and perspective transforms', () => {
    const size = { width: 450, height: 360 }, point = { x: 17.5, y: 220.125 };
    for (const quad of [[12, 24, 462, 24, 462, 384, 12, 384], [100, 0, 100, 100, 0, 100, 0, 0], [0, 0, 100, 0, 80, 100, 20, 100]]) {
        const actual = unprojectFramePoint(projectFramePoint(point, size, quad), size, quad);
        assert.ok(Math.hypot(actual.x - point.x, actual.y - point.y) < 1e-8);
    }
});
test('offscreen, non-finite and degenerate geometry cannot produce pointer coordinates', () => {
    const size = { width: 100, height: 100 }, quad = [0, 0, 100, 0, 100, 100, 0, 100];
    for (const point of [{ x: -1, y: 20 }, { x: 20, y: 101 }, { x: NaN, y: 20 }])
        assert.throws(() => projectFramePoint(point, size, quad), { code: 'ELEMENT_OFFSCREEN' });
    for (const invalid of [[], [0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 100, 0, 100, 100, 0, Infinity]])
        assert.throws(() => projectFramePoint({ x: 20, y: 20 }, size, invalid), { code: 'POINTER_GEOMETRY_UNAVAILABLE' });
    assert.throws(() => projectFramePoint({ x: 20, y: 20 }, { width: 0, height: 100 }, quad), { code: 'POINTER_GEOMETRY_UNAVAILABLE' });
});

test('a stalled preparation reaches its deadline without sending a late pointer event and cleans isolated markers', async t => {
    clearBrowserFrames(77);
    let now = 1000;
    t.mock.method(Date, 'now', () => now);
    const calls = [], cleanups = [];
    const chrome = {
        scripting: { executeScript: async request => {
            if (String(request.func).includes('delete')) cleanups.push(request);
            return [{ frameId: 12, documentId: 'example-pointer-document', result: { ok: true, data: { x: 10, y: 20 } } }];
        } },
        debugger: { sendCommand: async (source, method, params) => {
            calls.push({ method, params });
            if (method === 'Page.bringToFront') now += 31000;
            if (method === 'Runtime.evaluate') return { result: { value: params.expression.startsWith('this[') } };
            return {};
        } },
    };
    for (const isDefault of [true, false]) await recordBrowserFrameEvent(chrome, { tabId: 77 }, 'Runtime.executionContextCreated', {
        context: { id: isDefault ? 1 : 2, uniqueId: isDefault ? 'example-main' : 'example-isolated', auxData: { isDefault, frameId: 'example-cdp-frame' } },
    });
    await assert.rejects(executeFramePointer(chrome, 77, 'click', { frameId: 12, documentId: 'example-pointer-document', selector: '#example' }, async () => {}), { code: 'POINTER_OPERATION_INTERRUPTED' });
    assert.equal(calls.some(call => call.method.startsWith('Input.')), false);
    assert.ok(cleanups.length >= 2);
    clearBrowserFrames(77);
});
