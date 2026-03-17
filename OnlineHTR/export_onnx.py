# export_onnx.py
from pathlib import Path
import argparse
import torch
import onnx

from src.models.carbune_module import LitModule1

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--ckpt", type=Path, required=True, help="Path to .ckpt")
    p.add_argument("--out", type=Path, required=True, help="Output .onnx path")
    p.add_argument("--opset", type=int, default=17)
    args = p.parse_args()

    device = torch.device("cpu")  # safest for ONNX export
    model = LitModule1.load_from_checkpoint(args.ckpt, map_location=device)
    model = model.to(device).eval()

    dummy = torch.randn(64, 1, 4, dtype=torch.float32, device=device)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with torch.no_grad():
        torch.onnx.export(
            model,
            dummy,
            str(args.out),
            input_names=["input"],
            output_names=["output"],
            dynamic_axes={
                "input": {0: "time_steps", 1: "batch"},
                "output": {0: "time_steps", 1: "batch"},
            },
            opset_version=args.opset,
            do_constant_folding=True,
        )

    onnx_model = onnx.load(str(args.out))
    onnx.checker.check_model(onnx_model)
    print(f"ONNX export OK: {args.out}")

if __name__ == "__main__":
    main()
