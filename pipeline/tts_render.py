#!/usr/bin/env python3
"""Render the Arabic navigation voice cues with a neural voice (edge-tts) and normalize loudness.

Each cue = one instruction from the journey script. Output: viewer/audio/cues/<cueId>.mp3
Loudness is normalized to -16 LUFS so every instruction plays at the same level.
Usage: python3 tts_render.py [--voice ar-EG-SalmaNeural] [--outdir ../viewer/audio/cues]
"""
import asyncio, json, os, subprocess, sys, tempfile

import edge_tts

HERE = os.path.dirname(os.path.abspath(__file__))
OUTDIR = os.path.abspath(os.path.join(HERE, '..', 'viewer', 'audio', 'cues'))
VOICE = 'ar-EG-SalmaNeural'          # سلمى — نبرة أكاديمية هادئة
RATE = '-10%'                        # أهدأ قليلاً من الافتراضي: وضوح ونبرة مرشدة
TARGET_LUFS = -16                    # معيار البودكاست/الإرشاد الصوتي

# The full cue sheet: id -> spoken Arabic text.
# Numbers follow the real measured geometry (491 m walk, 20+18+18 stairs, floors G/1/2/3).
CUES = {
    # 3 — opening, after «وديني»
    'welcome':       'مرحبًا بك. سنرشدك الآن إلى وجهتك: قاعة 3 في مبنى هندسة 1، الدور الثالث. المسافة الإجمالية حوالي 490 مترًا، وتستغرق قرابة ست دقائق سيرًا. اتبع التعليمات خطوة بخطوة.',
    # 4 — outdoor walk
    'gate':          'ادخل الحرم من البوابة الرئيسية، ثم تابع السير في الممر المركزي باتجاه مبنى هندسة 1.',
    # 5 — progress milestone (half of the outdoor distance)
    'halfway':       'قطعت حتى الآن حوالي 250 مترًا. أنت تسير في الاتجاه الصحيح، وبقي نحو 240 مترًا حتى مدخل المبنى.',
    # 6 — approaching the entrance
    'approach':      'مبنى هندسة 1 أمامك الآن. اقترب من المدخل الرئيسي.',
    # 7 — crossing the door
    'enter':         'اعبر من المدخل إلى اللوبي.',
    # 8 — heading to the stairwell
    'to_stairs':     'اتجه داخل اللوبي نحو بئر السلم.',
    # 9 — at the stairwell, first flight
    'stairs_start':  'لقد وصلت إلى بداية السلم. توقف لحظة، وتهيأ للصعود إلى الدور الأول. عشرون درجة تفصلك عنه.',
    # 10a — first flight
    'climb_1':       'ابدأ الصعود بهدوء، درجةً درجة.',
    # 10b — first floor landing
    'floor_1':       'أنت الآن في الدور الأول. أكمل الصعود عبر الجزء التالي من السلم. ثماني عشرة درجة.',
    # 10c — second floor landing
    'floor_2':       'وصلت إلى الدور الثاني. بقيت رحلة أخيرة، ثماني عشرة درجة إلى الدور الثالث.',
    # 10d — third floor reached
    'floor_3':       'أنت الآن في الدور الثالث.',
    # 11 — corridor
    'corridor':      'اتجه نحو الممر، وتابع السير حتى قاعة 3.',
    # 12 — arrival
    'arrived':       'لقد وصلت إلى وجهتك بنجاح: قاعة 3. يمكنك الآن التوقف واستكشاف المكان.',
    # extra — generic fallbacks used for other destinations (templated at runtime)
    'gen_out':       'تابع السير في الاتجاه المحدد.',
    'gen_room':      'لقد وصلت إلى وجهتك بنجاح. يمكنك الآن التوقف واستكشاف المكان.',
    # voice-picker preview
    'preview':       'مرحبًا بك. هذا مثال على الصوت المرشد داخل الحرم الجامعي.',
}


def loudness_normalize(path: str, lufs: float = TARGET_LUFS) -> None:
    """Two-pass loudnorm to a single consistent level across all cues."""
    probe = subprocess.run(
        ['ffmpeg', '-hide_banner', '-i', path, '-af', f'loudnorm=I={lufs}:TP=-1.5:LRA=11:print_format=json',
         '-f', 'null', '-'], capture_output=True, text=True)
    import re
    m = re.search(r'\{[^{}]*"input_i"[^{}]*\}', probe.stderr, re.S)
    if not m:
        return
    stats = json.loads(m.group(0))
    measured = f"loudnorm=I={lufs}:TP=-1.5:LRA=11:measured_I={stats['input_i']}:measured_TP={stats['input_tp']}:measured_LRA={stats['input_lra']}:measured_thresh={stats['input_thresh']}:offset={stats['target_offset']}:linear=true:print_format=summary"
    with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False, dir=os.path.dirname(path)) as f:
        tmp = f.name
    subprocess.run(['ffmpeg', '-hide_banner', '-y', '-i', path, '-af', measured, '-codec:a', 'libmp3lame', '-b:a', '48k', tmp],
                   capture_output=True, check=True)
    os.replace(tmp, path)


async def render(voice: str = VOICE, outdir: str = OUTDIR) -> dict:
    os.makedirs(outdir, exist_ok=True)
    report = {}
    for cue_id, text in CUES.items():
        out = os.path.join(outdir, f'{cue_id}.mp3')
        for attempt in range(3):
            try:
                c = edge_tts.Communicate(text, voice=voice, rate=RATE)
                await c.save(out)
                break
            except Exception as e:
                if attempt == 2:
                    report[cue_id] = f'FAIL: {e}'
                    continue
                await asyncio.sleep(1.5)
        if os.path.exists(out) and os.path.getsize(out) > 1000:
            loudness_normalize(out)
            report[cue_id] = f'OK {os.path.getsize(out)//1024}KB'
        elif cue_id not in report:
            report[cue_id] = 'FAIL: too small'
    return report


if __name__ == '__main__':
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('--voice', default=VOICE)
    ap.add_argument('--outdir', default=OUTDIR)
    a = ap.parse_args()
    rep = asyncio.run(render(a.voice, a.outdir))
    print(json.dumps(rep, ensure_ascii=False, indent=1))
    fails = [k for k, v in rep.items() if not v.startswith('OK')]
    print(f"\n{len(rep)-len(fails)}/{len(rep)} cues rendered → {a.outdir}")
    sys.exit(1 if fails else 0)
