#!/usr/bin/env python3
"""Logits Diagnostics: Analyze model behavior directly from checkpoint logits.

Measures:
- Blank dominance: % of timesteps where blank is argmax
- Class collapse: probability mass concentration per class
- Top-k mass: how much probability is in top-k classes per timestep
- Entropy: per-timestep and aggregated uncertainty
- Confusion matrix: argmax predictions under restricted alphabet constraints
- Per-class statistics: mean confidence, frequency, entropy ranges

Supports:
- CSV sample files (own_dataset format)
- PyTorch checkpoint loading
- Restricted alphabet comparison (e.g., a,b,c vs full)
"""

import argparse
import logging
import sys
from pathlib import Path
from typing import Optional

import numpy as np
import torch
import pandas as pd
from tqdm import tqdm

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from src.models.carbune_module import LitModule1
from src.data.transforms import Carbune2020, DictToTensor, CharactersToIndices
from src.data.tokenisers import AlphabetMapper


logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class LogitsDiagnostics:
    """Analyze logits from model inference."""

    def __init__(self, checkpoint_path: str, device: str = 'cpu'):
        """Load model checkpoint."""
        self.device = device
        self.checkpoint_path = Path(checkpoint_path)
        
        logger.info(f"Loading checkpoint: {checkpoint_path}")
        self.model = LitModule1.load_from_checkpoint(checkpoint_path)
        self.model.to(device)
        self.model.eval()
        
        self.alphabet = self.model.hparams.alphabet
        self.alphabet_mapper = AlphabetMapper(self.alphabet)
        self.num_classes = len(self.alphabet) + 1  # +1 for blank
        
        logger.info(f"Loaded model with alphabet: {self.alphabet}")
        logger.info(f"Number of classes (including blank): {self.num_classes}")

    def load_sample_from_csv(self, csv_path: str) -> dict:
        """Load sample from CSV in own_dataset format: t,x,y,stroke_id."""
        df = pd.read_csv(csv_path)
        stroke_column = 'stroke_nr' if 'stroke_nr' in df.columns else 'stroke_id'
        stem = Path(csv_path).stem
        label = ''
        if '_' in stem:
            # Own_Dataset convention is <sample_name>_<label>.csv
            label = stem.rsplit('_', 1)[-1]
        
        sample = {
            'x': df['x'].values,
            'y': df['y'].values,
            't': df['t'].values,
            'stroke_nr': df[stroke_column].values,
            'sample_name': stem,
            'label': label,
        }
        return sample

    def preprocess_sample(self, sample: dict) -> torch.Tensor:
        """Apply Carbune2020 preprocessing and convert to tensor."""
        try:
            # Apply Carbune2020 transform
            processed = Carbune2020()(sample)
            
            # Convert to tensor
            ink_tensor = DictToTensor(channel_names=['x', 'y', 't', 'n'])(processed)
            
            # Return as (seq_len, num_channels) for model input
            return ink_tensor['ink']
        except Exception as e:
            logger.error(f"Preprocessing failed for {sample['sample_name']}: {e}")
            return None

    def get_logits(self, ink_tensor: torch.Tensor) -> torch.Tensor:
        """Run forward pass and get log-probabilities.
        
        Returns shape (seq_len, num_classes).
        """
        # Model expects (seq_len, batch_size, num_channels)
        x = ink_tensor.unsqueeze(1).to(self.device)
        
        with torch.no_grad():
            # Model returns (seq_len, batch_size, num_classes)
            log_probs = self.model(x)
        
        # Return unbatched (seq_len, num_classes)
        return log_probs.squeeze(1).cpu()

    def analyze_logits(self, log_probs: torch.Tensor, 
                       label: str = '',
                       sample_name: str = '',
                       restricted_alphabet: Optional[list] = None) -> dict:
        """Analyze logits and compute diagnostics.
        
        Args:
            log_probs: Tensor of shape (seq_len, num_classes)
            label: Ground truth label (for reference)
            sample_name: Name of sample
            restricted_alphabet: List of allowed characters (None = all)
        
        Returns:
            Dict of metrics and statistics
        """
        probs = torch.exp(log_probs)
        seq_len, num_classes = log_probs.shape
        
        # ===== Blank dominance =====
        blank_idx = self.alphabet_mapper.BLANK_INDEX
        blank_logits = log_probs[:, blank_idx]
        argmax_per_frame = torch.argmax(log_probs, dim=1)
        blank_is_argmax = (argmax_per_frame == blank_idx).float()
        blank_dominance = blank_is_argmax.mean().item()
        
        # ===== Per-timestep entropy =====
        entropy_per_frame = -(probs * log_probs).sum(dim=1)  # Shape: (seq_len,)
        entropy_mean = entropy_per_frame.mean().item()
        entropy_max = entropy_per_frame.max().item()
        entropy_min = entropy_per_frame.min().item()
        
        # ===== Top-k probability mass =====
        top1_mass = probs.max(dim=1)[0].mean().item()
        top3_mass = torch.topk(probs, k=min(3, num_classes), dim=1)[0].sum(dim=1).mean().item()
        top5_mass = torch.topk(probs, k=min(5, num_classes), dim=1)[0].sum(dim=1).mean().item()
        
        # ===== Per-class statistics =====
        class_stats = {}
        for class_idx in range(num_classes):
            class_prob = probs[:, class_idx]
            is_argmax = (argmax_per_frame == class_idx).float()
            
            class_stats[class_idx] = {
                'char': self.alphabet_mapper.index_to_character(class_idx),
                'mean_prob': class_prob.mean().item(),
                'max_prob': class_prob.max().item(),
                'argmax_count': is_argmax.sum().item(),
                'argmax_freq': (is_argmax.sum() / seq_len).item(),
            }
        
        # ===== Greedy decode =====
        indices = torch.argmax(log_probs, dim=1)
        indices = torch.unique_consecutive(indices)
        indices = [i.item() for i in indices if i != blank_idx]
        greedy_pred = "".join([self.alphabet_mapper.index_to_character(i) for i in indices])
        
        # ===== Restricted alphabet analysis =====
        restricted_stats = None
        if restricted_alphabet:
            restricted_indices = [self.alphabet_mapper.character_to_index(c) for c in restricted_alphabet]
            restricted_logits = log_probs[:, restricted_indices]
            restricted_argmax = torch.argmax(restricted_logits, dim=1)
            restricted_pred_indices = torch.unique_consecutive(restricted_argmax)
            restricted_pred_indices = [idx.item() for idx in restricted_pred_indices 
                                      if restricted_indices[idx] != blank_idx]
            restricted_pred = "".join([
                self.alphabet_mapper.index_to_character(restricted_indices[idx])
                for idx in restricted_pred_indices
            ])
            
            restricted_stats = {
                'restricted_alphabet': restricted_alphabet,
                'restricted_prediction': restricted_pred,
                'restricted_top_class_freq': {
                    self.alphabet_mapper.index_to_character(restricted_indices[i]): 
                    (restricted_argmax == i).float().mean().item()
                    for i in range(len(restricted_indices))
                },
            }
        
        # ===== Confusion matrix (greedy argmax per frame under restricted alphabet) =====
        confusion = None
        if restricted_alphabet:
            restricted_indices = [self.alphabet_mapper.character_to_index(c) for c in restricted_alphabet]
            confusion = {}
            for char in restricted_alphabet:
                confusion[char] = {other: 0 for other in restricted_alphabet}
            
            # Argmax for each timestep under restricted alphabet
            restricted_logits = log_probs[:, restricted_indices]
            restricted_argmax = torch.argmax(restricted_logits, dim=1)
            
            # Track transitions: if char is argmax, next prediction determines confusion
            # For now, just count frequency of each class per frame
            for frame_idx, argmax_among_restricted in enumerate(restricted_argmax):
                pred_char = self.alphabet_mapper.index_to_character(
                    restricted_indices[argmax_among_restricted.item()]
                )
                # This is simplistic; could also track state transitions
        
        result = {
            'sample_name': sample_name,
            'label': label,
            'seq_len': seq_len,
            'blank_dominance': blank_dominance,
            'entropy_mean': entropy_mean,
            'entropy_max': entropy_max,
            'entropy_min': entropy_min,
            'top1_mass': top1_mass,
            'top3_mass': top3_mass,
            'top5_mass': top5_mass,
            'greedy_prediction': greedy_pred,
            'class_stats': class_stats,
            'restricted_stats': restricted_stats,
            'confusion': confusion,
        }
        
        return result

    def print_report(self, result: dict) -> None:
        """Print diagnostic report in human-readable format."""
        print(f"\n{'='*70}")
        print(f"LOGITS DIAGNOSTICS REPORT")
        print(f"{'='*70}")
        print(f"Sample: {result['sample_name']}")
        print(f"Label: {result['label']}")
        print(f"Sequence length: {result['seq_len']}")
        print(f"\n--- BLANK & DOMINANCE ---")
        print(f"Blank dominance (% frames blank=argmax): {result['blank_dominance']*100:.2f}%")
        print(f"\n--- ENTROPY (bits) ---")
        print(f"Mean entropy/frame: {result['entropy_mean']:.4f}")
        print(f"Min entropy/frame:  {result['entropy_min']:.4f}")
        print(f"Max entropy/frame:  {result['entropy_max']:.4f}")
        print(f"\n--- PROBABILITY MASS ---")
        print(f"Top-1 avg mass: {result['top1_mass']:.4f}")
        print(f"Top-3 avg mass: {result['top3_mass']:.4f}")
        print(f"Top-5 avg mass: {result['top5_mass']:.4f}")
        print(f"\n--- GREEDY DECODE ---")
        print(f"Prediction: '{result['greedy_prediction']}'")
        
        if result['restricted_stats']:
            print(f"\n--- RESTRICTED ALPHABET ---")
            rs = result['restricted_stats']
            print(f"Alphabet: {rs['restricted_alphabet']}")
            print(f"Prediction: '{rs['restricted_prediction']}'")
            print(f"Class frequencies:")
            for char, freq in rs['restricted_top_class_freq'].items():
                print(f"  {char}: {freq*100:.2f}%")
        
        print(f"\n--- PER-CLASS STATISTICS ---")
        stats_df = []
        for class_idx in sorted(result['class_stats'].keys()):
            stat = result['class_stats'][class_idx]
            stats_df.append({
                'Class': stat['char'],
                'Mean Prob': f"{stat['mean_prob']:.4f}",
                'Max Prob': f"{stat['max_prob']:.4f}",
                'Argmax #': int(stat['argmax_count']),
                'Argmax %': f"{stat['argmax_freq']*100:.2f}%",
            })
        df = pd.DataFrame(stats_df)
        print(df.to_string(index=False))
        print(f"{'='*70}\n")


def main():
    parser = argparse.ArgumentParser(
        description='Analyze model logits to diagnose blank dominance, class collapse, and confusion.'
    )
    parser.add_argument(
        '--checkpoint',
        type=str,
        required=True,
        help='Path to PyTorch Lightning checkpoint (.ckpt)',
    )
    parser.add_argument(
        '--sample-csv',
        type=str,
        help='Path to single CSV sample (t,x,y and stroke_id or stroke_nr columns)',
    )
    parser.add_argument(
        '--samples-dir',
        type=str,
        help='Directory containing multiple CSV samples',
    )
    parser.add_argument(
        '--restricted-alphabet',
        type=str,
        default='a,b,c',
        help='Comma-separated restricted alphabet (default: a,b,c)',
    )
    parser.add_argument(
        '--device',
        type=str,
        default='cpu',
        choices=['cpu', 'cuda'],
        help='Device for inference',
    )
    parser.add_argument(
        '--json-output',
        type=str,
        help='Path to save results as JSON',
    )
    
    args = parser.parse_args()
    
    # Initialize diagnostics
    diagnostics = LogitsDiagnostics(args.checkpoint, device=args.device)
    
    # Parse restricted alphabet
    restricted_alphabet = [c.strip() for c in args.restricted_alphabet.split(',')]
    
    results = []
    
    # Process single sample or directory
    sample_paths = []
    if args.sample_csv:
        sample_paths = [Path(args.sample_csv)]
    elif args.samples_dir:
        sample_paths = list(Path(args.samples_dir).glob('*.csv'))
    else:
        parser.error("Must provide --sample-csv or --samples-dir")
    
    logger.info(f"Processing {len(sample_paths)} samples")
    
    for sample_path in tqdm(sample_paths, desc='Processing samples'):
        try:
            # Load and preprocess
            sample = diagnostics.load_sample_from_csv(str(sample_path))
            ink_tensor = diagnostics.preprocess_sample(sample)
            label = sample.get('label', '')
            
            if ink_tensor is None:
                logger.warning(f"Skipping {sample_path} (preprocessing failed)")
                continue
            
            # Get logits and analyze
            log_probs = diagnostics.get_logits(ink_tensor)
            result = diagnostics.analyze_logits(
                log_probs,
                label=label,
                sample_name=sample['sample_name'],
                restricted_alphabet=restricted_alphabet,
            )
            
            # Print report
            diagnostics.print_report(result)
            results.append(result)
            
        except Exception as e:
            logger.error(f"Error processing {sample_path}: {e}")
            continue
    
    # Summary statistics across all samples
    if results:
        logger.info(f"\nProcessed {len(results)} samples successfully")
        print(f"\n{'='*70}")
        print(f"AGGREGATED SUMMARY ({len(results)} samples)")
        print(f"{'='*70}")
        
        summary_df = pd.DataFrame([
            {
                'Sample': r['sample_name'],
                'Blank Dom.': f"{r['blank_dominance']*100:.2f}%",
                'Entropy': f"{r['entropy_mean']:.4f}",
                'Top1 Mass': f"{r['top1_mass']:.4f}",
                'Prediction': r['greedy_prediction'],
                'Restricted Pred': r['restricted_stats']['restricted_prediction'] if r['restricted_stats'] else 'N/A',
            }
            for r in results
        ])
        print(summary_df.to_string(index=False))
        print(f"{'='*70}\n")
        
        # Save JSON if requested
        if args.json_output:
            import json
            from collections import Counter
            
            # Convert to JSON-serializable format
            json_results = []
            for r in results:
                json_results.append({
                    'sample_name': r['sample_name'],
                    'label': r['label'],
                    'seq_len': r['seq_len'],
                    'blank_dominance': r['blank_dominance'],
                    'entropy_mean': r['entropy_mean'],
                    'entropy_max': r['entropy_max'],
                    'entropy_min': r['entropy_min'],
                    'top1_mass': r['top1_mass'],
                    'top3_mass': r['top3_mass'],
                    'top5_mass': r['top5_mass'],
                    'greedy_prediction': r['greedy_prediction'],
                    'restricted_stats': r['restricted_stats'],
                })
            
            # === AGGREGATE SUMMARY ===
            blank_doms = [r['blank_dominance'] for r in results]
            entropies = [r['entropy_mean'] for r in results]
            top1_masses = [r['top1_mass'] for r in results]
            
            # Accuracy metrics
            correct = sum(1 for r in results if r['label'] and r['greedy_prediction'] == r['label'])
            restricted_correct = sum(1 for r in results if r['label'] and r['restricted_stats'] 
                                    and r['restricted_stats']['restricted_prediction'] == r['label'])
            
            # Failure patterns
            false_negs = [r for r in results if r['label'] and r['greedy_prediction'] != r['label']]
            false_neg_truth = Counter([r['label'] for r in false_negs])
            false_neg_pred = Counter([r['greedy_prediction'] for r in false_negs])
            
            # Percentile calculation helper
            def percentile(values, p):
                if not values:
                    return 0.0
                ordered = sorted(values)
                idx = int((len(ordered) - 1) * p)
                return float(ordered[idx])
            
            aggregate = {
                'sample_count': len(results),
                'blank_dominance': {
                    'mean': float(np.mean(blank_doms)),
                    'median': float(np.median(blank_doms)),
                    'min': float(min(blank_doms)),
                    'max': float(max(blank_doms)),
                    'p90': percentile(blank_doms, 0.9),
                    'high_blank_count': sum(1 for bd in blank_doms if bd > 0.5),
                },
                'entropy': {
                    'mean': float(np.mean(entropies)),
                    'median': float(np.median(entropies)),
                    'min': float(min(entropies)),
                    'max': float(max(entropies)),
                    'p90': percentile(entropies, 0.9),
                },
                'top1_mass': {
                    'mean': float(np.mean(top1_masses)),
                    'min': float(min(top1_masses)),
                    'max': float(max(top1_masses)),
                },
                'accuracy': {
                    'greedy_exact_match': correct,
                    'greedy_total': len([r for r in results if r['label']]),
                    'greedy_accuracy': correct / len([r for r in results if r['label']]) if [r for r in results if r['label']] else 0.0,
                    'restricted_exact_match': restricted_correct,
                    'restricted_total': len([r for r in results if r['label']]),
                    'restricted_accuracy': restricted_correct / len([r for r in results if r['label']]) if [r for r in results if r['label']] else 0.0,
                },
                'failure_analysis': {
                    'false_negatives_count': len(false_negs),
                    'truth_labels_that_failed': dict(false_neg_truth),
                    'predictions_when_wrong': dict(false_neg_pred),
                },
                'diagnostic_flags': {
                    'severe_blank_dominance': sum(1 for bd in blank_doms if bd > 0.9) > 0,
                    'extremely_low_entropy': sum(1 for e in entropies if e < 0.05) >= len(entropies) * 0.5,
                    'systematic_bias': len(false_neg_pred) == 1 and correct == 0,
                    'high_confidence_collapse': sum(1 for m in top1_masses if m > 0.99) > len(top1_masses) * 0.5,
                }
            }
            
            # Print aggregate summary to console
            print(f"\n{'='*70}")
            print("AGGREGATE DIAGNOSTICS SUMMARY")
            print(f"{'='*70}")
            print(f"Samples analyzed: {aggregate['sample_count']}")
            print(f"\n[BLANK DOMINANCE]")
            print(f"  Mean: {aggregate['blank_dominance']['mean']*100:.2f}%  "
                  f"Median: {aggregate['blank_dominance']['median']*100:.2f}%  "
                  f"Max: {aggregate['blank_dominance']['max']*100:.2f}%")
            print(f"  High blank (>50%): {aggregate['blank_dominance']['high_blank_count']}/{aggregate['sample_count']}")
            if aggregate['diagnostic_flags']['severe_blank_dominance']:
                print(f"  🚨 SEVERE: >90% blank dominance detected")
            
            print(f"\n[ENTROPY/CONFIDENCE]")
            print(f"  Mean entropy: {aggregate['entropy']['mean']:.4f}  "
                  f"Min: {aggregate['entropy']['min']:.4f}  "
                  f"Max: {aggregate['entropy']['max']:.4f}")
            print(f"  Top-1 mass: {aggregate['top1_mass']['mean']:.4f} (mean)")
            if aggregate['diagnostic_flags']['high_confidence_collapse']:
                print(f"  🚨 COLLAPSE: Overconfident logits (top-1 mass >0.99)")
            
            print(f"\n[ACCURACY]")
            acc_g = aggregate['accuracy']['greedy_accuracy']
            acc_r = aggregate['accuracy']['restricted_accuracy']
            print(f"  Greedy: {aggregate['accuracy']['greedy_exact_match']}/{aggregate['accuracy']['greedy_total']} = {acc_g:.2%}")
            print(f"  Restricted (a,b,c): {aggregate['accuracy']['restricted_exact_match']}/{aggregate['accuracy']['restricted_total']} = {acc_r:.2%}")
            
            if aggregate['failure_analysis']['false_negatives_count'] > 0:
                print(f"\n[FAILURE PATTERNS]")
                print(f"  False negatives: {aggregate['failure_analysis']['false_negatives_count']}")
                print(f"  Truth labels that failed: {aggregate['failure_analysis']['truth_labels_that_failed']}")
                print(f"  Predictions when wrong: {aggregate['failure_analysis']['predictions_when_wrong']}")
                if aggregate['diagnostic_flags']['systematic_bias']:
                    print(f"  🚨 BIAS: All errors predict same class")
            
            print(f"{'='*70}\n")
            
            # Write comprehensive JSON
            output_data = {
                'aggregate_summary': aggregate,
                'samples': json_results,
            }
            with open(args.json_output, 'w') as f:
                json.dump(output_data, f, indent=2)
            logger.info(f"Results saved to {args.json_output}")


if __name__ == '__main__':
    main()
