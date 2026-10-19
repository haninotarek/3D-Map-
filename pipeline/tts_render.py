#!/usr/bin/env python3
"""Render the Arabic navigation voice cues with a neural voice (edge-tts) and normalize loudness.

Style (Oct 2026): SHORT Egyptian-colloquial lines («عامية شعبية»), spoken slowly — one announcement
per leg and no repetition: (1) «صباح الخير يا هندسة» at the main gate, then walk straight to the named
building, (2) take the right/left stair for this room straight to its floor (every intermediate floor,
including the first, stays silent), (3) on that floor, turn right/left to the room. route.js composes
these from cues (greeting_gate + go_eng*, stairs_<side>_floor_*, floor_* + turn_*), choosing
the sides from the interior geometry. The older welcome/gate/halfway/approach cues below are retained
only as generic fallbacks / voice-picker preview and are not spoken during a normal tour. The shipped
MP3s were rendered with the colloquial voice chosen by the project owner (33 files). This script keeps
the full text sheet as the source of truth for re-rendering with any ar-EG voice.
Each cue = one instruction from the journey script. Output: viewer/audio/cues/<cueId>.mp3
Loudness is normalized to -16 LUFS so every instruction plays at the same level.
Usage: python3 tts_render.py [--voice ar-EG-ShakirNeural] [--outdir ../viewer/audio/cues]
"""
import asyncio, json, os, subprocess, sys, tempfile

import edge_tts

HERE = os.path.dirname(os.path.abspath(__file__))
OUTDIR = os.path.abspath(os.path.join(HERE, '..', 'viewer', 'audio', 'cues'))
VOICE = 'ar-EG-ShakirNeural'         # صوت مصري — بديل edge-tts لإعادة التوليد (الملفات المشحونة بصوت عامي مختار)
RATE = '-25%'                        # بطيء وواضح: المرشد يتكلم على مهله
TARGET_LUFS = -16                    # معيار البودكاست/الإرشاد الصوتي

# The full cue sheet: id -> spoken Arabic text. Short & colloquial on purpose — the welcome is
# generic (it used to hardcode one destination), and no cue recites distances or stair counts.
CUES = {
    # opening, after «وديني»
    'welcome':       'أهلاً بيك. يلا بينا. هوصّلك لحد قاعتك. امشي معايا، واحدة، واحدة.',
    # outdoor walk
    'gate':          'ادخل من البوابة. وامشي على طول.',
    # progress milestone (half of the outdoor walk)
    'halfway':       'انت كده في نص الطريق. كمّل على طول.',
    # approaching the entrance
    'approach':      'المبنى قدامك. قرّب من الباب.',
    # crossing the door
    'enter':         'ادخل جوّه. ده اللوبي.',
    # heading to the stairwell
    'to_stairs':     'روح عند السلم. واطلع على مهلك.',
    # at the stairwell
    'stairs_start':  'وصلت عند السلم. اطلع على مهلك.',
    # climbing the next flight
    'climb_1':       'كمّل طالع. واحدة، واحدة.',
    # floor landings (1 / 2 / 3)
    'floor_1':       'انت كده في الدور الأول.',
    'floor_2':       'انت كده في الدور التاني.',
    'floor_3':       'انت كده في الدور التالت.',
    # corridor
    'corridor':      'امشي في الممر، على طول.',
    # arrival
    'arrived':       'خلاص، وصلت. بالتوفيق!',
    # generic fallbacks for other destinations
    'gen_out':       'كمّل ماشي على طول.',
    'gen_room':      'خلاص، وصلت. بالتوفيق!',
    # voice-picker preview
    'preview':       'أهلاً بيك. ده صوت المرشد بتاعك في الجامعة.',
    # --- directional cues composed by route.js (the normal tour narration) ---
    'greeting_gate': 'صباح الخير يا هندسة. عدّي البوابة الرئيسية،',
    'go_eng1':       'امشي على طول، لحد ما توصل لمبنى هندسة واحد.',
    'go_eng2':       'امشي على طول، لحد ما توصل لمبنى هندسة اتنين.',
    'stairs_right':  'اطلع من السلم اليمين،',
    'stairs_left':   'اطلع من السلم الشمال،',
    'upto_floor_1':  'لحد الدور الأول.',
    'upto_floor_2':  'لحد الدور التاني.',
    'upto_floor_3':  'لحد الدور التالت.',
    'turn_right':    'خش يمين.',
    'turn_left':     'خش شمال.',
    'go_straight':   'كمّل على طول.',
    # direct climb recordings (no intermediate-floor announcements during the climb)
    'stairs_right_floor_1': 'اطلع من السلم اللي على اليمين، لحد الدور الأول على طول.',
    'stairs_right_floor_2': 'اطلع من السلم اللي على اليمين، لحد الدور التاني على طول.',
    'stairs_right_floor_3': 'اطلع من السلم اللي على اليمين، لحد الدور التالت على طول.',
    'stairs_left_floor_1':  'اطلع من السلم اللي على الشمال، لحد الدور الأول على طول.',
    'stairs_left_floor_2':  'اطلع من السلم اللي على الشمال، لحد الدور التاني على طول.',
    'stairs_left_floor_3':  'اطلع من السلم اللي على الشمال، لحد الدور التالت على طول.',
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
