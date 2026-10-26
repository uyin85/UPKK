"""
Hermes 4 (Nous Research) di Modal — penyelesai buta kedua untuk pipeline QA UPKK.
API serasi OpenAI (vLLM). Bekas tidur sendiri bila tiada permintaan (scaledown), jadi kos
hanya dikira semasa batch malam berjalan.

Persediaan:
  pip install modal
  modal setup
  modal secret create upkk-hermes HERMES_API_KEY=<rentetan-rawak-panjang>
  modal deploy modal/hermes_server.py

URL yang dipaparkan (…modal.run) → wrangler secret put HERMES_URL
Kunci yang sama                 → wrangler secret put HERMES_API_KEY
"""
import os
import subprocess

import modal

# FP8 muat dalam L40S (48GB) dengan ruang untuk KV cache. Tukar ke "NousResearch/Hermes-4-14B"
# (BF16) jika guna A100-80GB.
MODEL = os.environ.get("HERMES_HF_MODEL", "NousResearch/Hermes-4-14B-FP8")
GPU = os.environ.get("HERMES_GPU", "L40S")

image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install("vllm>=0.10.1", "huggingface_hub[hf_transfer]")
    .env({"HF_HUB_ENABLE_HF_TRANSFER": "1"})
)

hf_cache = modal.Volume.from_name("hf-cache", create_if_missing=True)
vllm_cache = modal.Volume.from_name("vllm-cache", create_if_missing=True)

app = modal.App("upkk-hermes")


@app.function(
    image=image,
    gpu=GPU,
    timeout=60 * 30,
    scaledown_window=5 * 60,  # tidur selepas 5 minit tanpa permintaan
    max_containers=1,
    volumes={"/root/.cache/huggingface": hf_cache, "/root/.cache/vllm": vllm_cache},
    secrets=[modal.Secret.from_name("upkk-hermes")],
)
@modal.concurrent(max_inputs=16)
@modal.web_server(port=8000, startup_timeout=15 * 60)
def serve():
    cmd = [
        "vllm", "serve", MODEL,
        "--host", "0.0.0.0",
        "--port", "8000",
        "--served-model-name", "hermes",
        "--api-key", os.environ["HERMES_API_KEY"],
        "--max-model-len", "8192",
        "--gpu-memory-utilization", "0.90",
    ]
    subprocess.Popen(cmd)
