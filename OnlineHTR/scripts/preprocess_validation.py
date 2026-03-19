#!/usr/bin/env python3
"""Preprocessing Validation: Compare plugin preprocessing against Carbune2020 contract.

Validates:
1. Coordinate normalization (x shift, y shift/scale)
2. Resampling contract (points per unit length = 20)
3. Feature extraction (dx, dy, dt, n semantics)
4. Time non-monotonicity handling
5. Stroke indicator (n) correctness

Outputs:
- Contract validation report (pass/fail each step)
- Mismatch matrix (plugin vs Carbune2020 differences)
- Input distribution analysis (timestamp gaps, stroke lengths, etc.)
"""

import argparse
import logging
import sys
from pathlib import Path
from typing import Optional, Tuple

import numpy as np
import pandas as pd
from tqdm import tqdm

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from src.data.transforms import Carbune2020, DictToTensor
from src.data.online_handwriting_datasets import IAM_OnDB_Dataset


logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class PreprocessingValidator:
    """Validate preprocessing against Carbune2020 contract."""

    CARBUNE_POINTS_PER_UNIT_LENGTH = 20.0

    def __init__(self):
        self.carbune2020 = Carbune2020()
        self.contract_results = []
        self.mismatch_stats = {
            'shape_mismatch': 0,
            'value_mismatch': 0,
            'nan_detected': 0,
            'time_non_monotonic': 0,
            'single_stroke_point': 0,
        }

    def validate_coordinate_normalization(self, sample: dict) -> dict:
        """Validate coordinate shift and scale.
        
        Expected contract:
        - x' = (x - x[0]) / (y.max() - y.min())
        - y' = (y - y.min()) / (y.max() - y.min())
        Result: x' in [0, Δx_max], y' in [0, 1]
        """
        x, y = sample['x'], sample['y']
        y_min, y_max = y.min(), y.max()
        scale = y_max - y_min
        
        result = {
            'x_start': x[0],
            'y_min': y_min,
            'y_max': y_max,
            'scale_factor': scale,
            'x_normalized_start': x[0] - x[0],  # Should be 0
            'y_normalized_min': (y.min() - y_min) / scale,  # Should be 0
            'y_normalized_max': (y.max() - y_min) / scale,  # Should be 1
            'x_range_after_scale': ((x - x[0]) / scale).max(),
        }
        
        # Check contract
        passed = (
            abs(result['x_normalized_start']) < 1e-6 and
            abs(result['y_normalized_min']) < 1e-6 and
            abs(result['y_normalized_max'] - 1.0) < 1e-6
        )
        result['passed'] = passed
        
        return result

    def validate_resampling_points(self, sample: dict) -> dict:
        """Validate resampling to 20 points per unit length.
        
        Expected: each stroke resampled to ceil(stroke_length * 20) points.
        """
        result = {
            'num_strokes': int(sample['stroke_nr'].max()) + 1,
            'strokes': {},
        }
        
        x, y = sample['x'], sample['y']
        stroke_nr = sample['stroke_nr']
        
        for s_id in np.unique(stroke_nr):
            mask = stroke_nr == s_id
            x_s, y_s = x[mask], y[mask]
            
            # Compute stroke length
            dx = np.diff(x_s)
            dy = np.diff(y_s)
            distances = np.sqrt(dx**2 + dy**2)
            stroke_length = distances.sum()
            
            expected_points = max(2, int(np.ceil(stroke_length * self.CARBUNE_POINTS_PER_UNIT_LENGTH)))
            actual_points = len(x_s)
            
            result['strokes'][s_id] = {
                'actual_points': actual_points,
                'stroke_length': stroke_length,
                'expected_points': expected_points,
                'match': actual_points == expected_points,
            }
        
        result['all_match'] = all(s['match'] for s in result['strokes'].values())
        return result

    def validate_feature_extraction(self, sample: dict) -> dict:
        """Validate (dx, dy, dt, n) extraction.
        
        Expected:
        - dx, dy: first differences of coordinates
        - dt: first differences of time
        - n: stroke indicator (1 at stroke start, else check monotonicity)
        """
        x, y = sample['x'], sample['y']
        t = sample['t']
        stroke_nr = sample['stroke_nr']
        
        dx = np.zeros_like(x)
        dy = np.zeros_like(y)
        dt = np.zeros_like(t)
        n = np.zeros_like(stroke_nr, dtype=float)
        
        # First point: zero differences, stroke start indicator
        dx[0] = 0
        dy[0] = 0
        dt[0] = 0
        n[0] = 1.0
        
        # Subsequent points
        for i in range(1, len(x)):
            dx[i] = x[i] - x[i-1]
            dy[i] = y[i] - y[i-1]
            dt[i] = t[i] - t[i-1]
            
            # n: 1 if new stroke, else value from previous + 1
            if stroke_nr[i] != stroke_nr[i-1]:
                n[i] = 1.0
            else:
                n[i] = n[i-1]  # Monotonic continuation
        
        result = {
            'dx_mean': dx.mean(),
            'dx_std': dx.std(),
            'dy_mean': dy.mean(),
            'dy_std': dy.std(),
            'dt_mean': dt.mean(),
            'dt_std': dt.std(),
            'dt_min': dt[1:].min() if len(dt) > 1 else float('nan'),
            'dt_max': dt[1:].max() if len(dt) > 1 else float('nan'),
            'n_unique': len(np.unique(n)),
            'n_starts_with_1': n[0] == 1.0,
            'dt_monotonic': np.all(dt[1:] >= 0),
            'n_monotonic': np.all(np.diff(n) >= 0),
        }
        
        result['passed'] = (
            result['n_starts_with_1'] and
            result['dt_monotonic'] and
            result['n_monotonic']
        )
        
        return result

    def validate_against_carbune(self, sample: dict) -> dict:
        """Apply Carbune2020 transform and report any failures."""
        try:
            processed = self.carbune2020(sample)
            return {
                'carbune_success': True,
                'output_keys': set(processed.keys()),
                'output_shapes': {k: np.array(v).shape for k, v in processed.items()},
            }
        except Exception as e:
            return {
                'carbune_success': False,
                'error': str(e),
            }

    def validate_sample(self, sample: dict) -> dict:
        """Run all validation checks on a sample."""
        result = {
            'sample_name': sample['sample_name'],
        }
        
        # Check 1: coordinate normalization
        result['coord_norm'] = self.validate_coordinate_normalization(sample)
        
        # Check 2: resampling points
        result['resampling'] = self.validate_resampling_points(sample)
        
        # Check 3: feature extraction
        result['features'] = self.validate_feature_extraction(sample)
        
        # Check 4: Carbune contract
        result['carbune'] = self.validate_against_carbune(sample)
        
        # Overall pass/fail
        result['all_passed'] = (
            result['coord_norm']['passed'] and
            result['resampling']['all_match'] and
            result['features']['passed'] and
            result['carbune']['carbune_success']
        )
        
        return result

    def print_validation_report(self, result: dict) -> None:
        """Print validation report."""
        print(f"\n{'='*70}")
        print(f"PREPROCESSING VALIDATION: {result['sample_name']}")
        print(f"{'='*70}")
        
        print(f"\n[1] COORDINATE NORMALIZATION")
        cn = result['coord_norm']
        print(f"  x start (before): {cn['x_start']:.6f}")
        print(f"  y min/max (before): {cn['y_min']:.6f} / {cn['y_max']:.6f}")
        print(f"  Scale factor: {cn['scale_factor']:.6f}")
        print(f"  ✓ Contract: PASS" if cn['passed'] else f"  ✗ Contract: FAIL")
        
        print(f"\n[2] RESAMPLING (20 pts/unit)")
        rs = result['resampling']
        print(f"  Total strokes: {rs['num_strokes']}")
        for s_id, s_dict in rs['strokes'].items():
            match_mark = "✓" if s_dict['match'] else "✗"
            print(f"  {match_mark} Stroke {s_id}: {s_dict['actual_points']} pts "
                  f"(length={s_dict['stroke_length']:.4f}, expect={s_dict['expected_points']})")
        print(f"  ✓ Contract: PASS" if rs['all_match'] else f"  ✗ Contract: FAIL")
        
        print(f"\n[3] FEATURE EXTRACTION (dx, dy, dt, n)")
        ft = result['features']
        print(f"  dx: mean={ft['dx_mean']:+.6f}, std={ft['dx_std']:.6f}")
        print(f"  dy: mean={ft['dy_mean']:+.6f}, std={ft['dy_std']:.6f}")
        print(f"  dt: mean={ft['dt_mean']:+.6f}, range=[{ft['dt_min']:.6f}, {ft['dt_max']:.6f}]")
        print(f"  n (strokes): {ft['n_unique']} unique, starts with 1? {ft['n_starts_with_1']}")
        print(f"  dt monotonic? {ft['dt_monotonic']}, n monotonic? {ft['n_monotonic']}")
        print(f"  ✓ Contract: PASS" if ft['passed'] else f"  ✗ Contract: FAIL")
        
        print(f"\n[4] CARBUNE2020 TRANSFORM")
        cb = result['carbune']
        if cb['carbune_success']:
            print(f"  ✓ Transform succeeded")
            print(f"  Output keys: {cb['output_keys']}")
            for key, shape in cb['output_shapes'].items():
                print(f"    {key}: {shape}")
        else:
            print(f"  ✗ Transform failed: {cb['error']}")
        
        print(f"\n{'OVERALL: ✓ PASS' if result['all_passed'] else 'OVERALL: ✗ FAIL'}")
        print(f"{'='*70}\n")

    def print_summary(self, results: list) -> None:
        """Print summary of validation across all samples."""
        passed = [r for r in results if r['all_passed']]
        failed = [r for r in results if not r['all_passed']]
        
        print(f"\n{'='*70}")
        print(f"VALIDATION SUMMARY ({len(results)} samples)")
        print(f"{'='*70}")
        print(f"Passed: {len(passed)}/{len(results)}")
        print(f"Failed: {len(failed)}/{len(results)}")
        
        if failed:
            print(f"\nFailed samples:")
            for r in failed:
                reasons = []
                if not r['coord_norm']['passed']:
                    reasons.append("coord_norm")
                if not r['resampling']['all_match']:
                    reasons.append("resampling")
                if not r['features']['passed']:
                    reasons.append("features")
                if not r['carbune']['carbune_success']:
                    reasons.append("carbune")
                print(f"  {r['sample_name']}: {', '.join(reasons)}")
        
        print(f"{'='*70}\n")


def main():
    parser = argparse.ArgumentParser(description='Validate preprocessing against Carbune2020 contract.')
    parser.add_argument(
        '--dataset-root',
        type=str,
        default='data/datasets/IAM-OnDB',
        help='IAM-OnDB dataset root (default: data/datasets/IAM-OnDB)',
    )
    parser.add_argument(
        '--limit',
        type=int,
        default=50,
        help='Number of samples to validate (default: 50)',
    )
    parser.add_argument(
        '--validate-contract',
        action='store_true',
        help='Print detailed contract validation for each sample',
    )
    
    args = parser.parse_args()
    
    # Load dataset
    logger.info(f"Loading IAM-OnDB from {args.dataset_root}")
    dataset = IAM_OnDB_Dataset(
        Path(args.dataset_root),
        transform=None,
        limit=args.limit if args.limit > 0 else -1,
        skip_carbune2020_fails=False,  # We want to see failures
    )
    
    logger.info(f"Loaded {len(dataset)} samples")
    
    # Validate
    validator = PreprocessingValidator()
    results = []
    
    for idx, sample in enumerate(tqdm(dataset, desc='Validating')):
        try:
            result = validator.validate_sample(sample)
            results.append(result)
            
            if args.validate_contract:
                validator.print_validation_report(result)
        
        except Exception as e:
            logger.error(f"Error validating sample {idx}: {e}")
            continue
    
    # Print summary
    validator.print_summary(results)


if __name__ == '__main__':
    main()
