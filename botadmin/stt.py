# Thai speech-to-text for BotAdmin: faster-whisper on CPU (the GPU belongs to the LLM), models from the local HF cache only.
# Long-lived: reads one audio path per stdin line, answers one JSON line {"text"} or {"error"} on stdout.
# usage: python stt.py [model]   (tiny|small|medium, default small)
import json, os, sys, time

os.environ["HF_HUB_OFFLINE"] = "1"  # never download; the models are already in ~/.cache/huggingface
from faster_whisper import WhisperModel

name = sys.argv[1] if len(sys.argv) > 1 else "small"
model = WhisperModel(name, device="cpu", compute_type="int8", cpu_threads=max(2, (os.cpu_count() or 4) // 2))
print(json.dumps({"ready": name}), flush=True)
for line in sys.stdin:
    path = line.strip()
    if not path:
        continue
    t = time.time()
    try:
        segs, _ = model.transcribe(path, language="th", beam_size=5, vad_filter=True)
        text = "".join(s.text for s in segs).strip()
        print(json.dumps({"text": text, "ms": int((time.time() - t) * 1000)}), flush=True)
    except Exception as e:  # bad/empty recording: report and keep serving
        print(json.dumps({"error": str(e)}), flush=True)
