
import sys
sys.path.insert(0, '.')

import numpy as np
import pandas as pd
import torch
from pathlib import Path

from src.data.transforms import Carbune2020, DictToTensor
from src.model.BLSTM_SequenceModel import BlstmSeq2seqLanguageModel


def load_csv_sample(csv_path):
    """Load raw stroke data from CSV."""
    df = pd.read_csv(csv_path, index_col=0)
    data = {
        'sample_name': Path(csv_path).stem,
        'x': df['x'].values.astype(np.float32),
        'y': df['y'].values.astype(np.float32),
        't': df['t'].values.astype(np.float32),
        'stroke_nr': df['stroke_nr'].values.astype(np.int32),
    }
    print(f"Loaded {data['sample_name']}: {len(data['x'])} points")
    return data

# Load checkpoint
checkpoint_path = "models/dataIAMOnDB_featuresLinInterpol20DxDyDtN_decoderGreedy/checkpoints/epoch=000699_step=0000106400_val_loss=0.2650.ckpt"
print(f"Loading checkpoint...")
checkpoint = torch.load(checkpoint_path, map_location='cpu')
model_config = checkpoint['hyper_parameters']
model = BlstmSeq2seqLanguageModel(**model_config)
model.load_state_dict(checkpoint['state_dict'])
model.eval()
print("Model loaded")

carbune = Carbune2020()
dict_to_tensor = DictToTensor()

real_samples = [
    'data/datasets/own_dataset/1_hello.csv',
]

print("\nTESTING REAL MULTI-CHARACTER SAMPLE")

for csv_path in real_samples:
    if not Path(csv_path).exists():
        continue
        
    print(f"\n--- {Path(csv_path).stem} ---")
    raw_sample = load_csv_sample(csv_path)
    processed = carbune(raw_sample)
    
    if processed == 'FAILED_SAMPLE':
        print("  Failed preprocessing")
        continue
    
    tensor_sample = dict_to_tensor(processed)
    ink = tensor_sample['ink'].unsqueeze(0)
    
    print(f"  Input shape: {ink.shape}, Seq len: {ink.shape[1]}")
    
    with torch.no_grad():
        logits = model(ink)
    
    logits_np = logits.squeeze(0).cpu().numpy()
    probs = torch.softmax(torch.tensor(logits_np), dim=-1).numpy()
    blank_prob = probs[:, 0]
    blank_dominance = blank_prob.mean()
    
    print(f"  Blank dominance: {blank_dominance:.1%}")
    print(f"  Blank range: min={blank_prob.min():.1%}, max={blank_prob.max():.1%}")
    
    top1_preds = logits_np.argmax(axis=1)
    print(f"  Top-1 first 20: {top1_preds[:20]}")
    print(f"  Blank count: {(top1_preds == 0).sum()} / {len(top1_preds)}")

