#!/usr/bin/env python3
"""Profile IAM-OnDB distribution and optional Carbune2020 failure behavior.

Example:
    python scripts/profile_iamondb_dataset.py --dataset-root data/datasets/IAM-OnDB
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from statistics import mean

import rootutils
from tqdm import tqdm

rootutils.setup_root(__file__, indicator='.project-root', pythonpath=True)

from src.data import FAILED_SAMPLE
from src.data.online_handwriting_datasets import IAM_OnDB_Dataset
from src.data.transforms import Carbune2020


def percentile(values: list[int], p: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    idx = int((len(ordered) - 1) * p)
    return float(ordered[idx])


def bucket_label_length(length: int) -> str:
    if length <= 1:
        return 'single-char'
    if length <= 5:
        return 'short(2-5)'
    if length <= 20:
        return 'medium(6-20)'
    return 'long(>20)'


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        '--dataset-root',
        type=Path,
        default=Path('data/datasets/IAM-OnDB'),
        help='Path containing IAM-OnDB folders (lineStrokes-all, ascii-all, ...).',
    )
    parser.add_argument('--limit', type=int, default=-1, help='Optional sample limit for faster diagnostics.')
    parser.add_argument(
        '--validate-carbune',
        action='store_true',
        help='Run Carbune2020 transform on each sample and report fail/exception counts.',
    )
    parser.add_argument(
        '--allow-empty',
        action='store_true',
        help='Allow empty dataset results without returning an error.',
    )
    parser.add_argument('--json-out', type=Path, default=None, help='Optional path to write JSON report.')
    args = parser.parse_args()

    dataset = IAM_OnDB_Dataset(args.dataset_root, transform=None, limit=args.limit)
    if len(dataset) == 0 and not args.allow_empty:
        print(
            f"ERROR: No samples found under {args.dataset_root}. "
            "Verify IAM-OnDB extraction layout or pass --allow-empty for dry runs."
        )
        return 2

    label_lengths: list[int] = []
    point_counts: list[int] = []
    stroke_counts: list[int] = []
    char_counter: Counter[str] = Counter()
    length_bucket_counter: Counter[str] = Counter()

    for sample in tqdm(dataset, desc='Profiling IAM_OnDB_Dataset'):
        label = sample['label']
        label_len = len(label)
        label_lengths.append(label_len)
        point_counts.append(len(sample['x']))
        stroke_counts.append(max(sample['stroke_nr']) + 1 if sample['stroke_nr'] else 0)
        char_counter.update(label)
        length_bucket_counter[bucket_label_length(label_len)] += 1

    report: dict[str, object] = {
        'dataset_root': str(args.dataset_root),
        'sample_count': len(dataset),
        'known_missing_text_samples': len(IAM_OnDB_Dataset.SAMPLES_NOT_TO_STORE),
        'known_carbune_problem_samples': len(IAM_OnDB_Dataset.SAMPLES_TO_SKIP_BC_CARBUNE2020_FAILS),
        'label_length': {
            'mean': mean(label_lengths) if label_lengths else 0.0,
            'min': min(label_lengths) if label_lengths else 0,
            'p50': percentile(label_lengths, 0.50),
            'p90': percentile(label_lengths, 0.90),
            'max': max(label_lengths) if label_lengths else 0,
            'bucket_counts': dict(length_bucket_counter),
        },
        'points_per_sample': {
            'mean': mean(point_counts) if point_counts else 0.0,
            'min': min(point_counts) if point_counts else 0,
            'p50': percentile(point_counts, 0.50),
            'p90': percentile(point_counts, 0.90),
            'max': max(point_counts) if point_counts else 0,
        },
        'strokes_per_sample': {
            'mean': mean(stroke_counts) if stroke_counts else 0.0,
            'min': min(stroke_counts) if stroke_counts else 0,
            'p50': percentile(stroke_counts, 0.50),
            'p90': percentile(stroke_counts, 0.90),
            'max': max(stroke_counts) if stroke_counts else 0,
        },
        'alphabet_size': len(char_counter),
        'top_chars': char_counter.most_common(25),
    }

    if args.validate_carbune:
        transform = Carbune2020()
        failed_sample_count = 0
        exception_count = 0

        for sample in tqdm(dataset, desc='Validating Carbune2020'):
            try:
                transformed = transform(sample)
                if transformed == FAILED_SAMPLE:
                    failed_sample_count += 1
            except Exception:
                exception_count += 1

        report['carbune_validation'] = {
            'failed_sample_count': failed_sample_count,
            'exception_count': exception_count,
            'evaluated_samples': len(dataset),
        }

    print('\n=== IAM-OnDB Dataset Profile ===')
    print(f"Dataset root: {args.dataset_root}")
    print(f"Sample count: {report['sample_count']}")
    print(f"Alphabet size: {report['alphabet_size']}")
    print(f"Label length buckets: {report['label_length']['bucket_counts']}")
    print(f"Label length mean/p90: {report['label_length']['mean']:.2f} / {report['label_length']['p90']:.2f}")
    print(f"Points per sample mean/p90: {report['points_per_sample']['mean']:.2f} / {report['points_per_sample']['p90']:.2f}")
    print(f"Top chars (25): {report['top_chars']}")

    if 'carbune_validation' in report:
        cv = report['carbune_validation']
        print(
            f"Carbune2020: failed={cv['failed_sample_count']} exceptions={cv['exception_count']} "
            f"evaluated={cv['evaluated_samples']}"
        )

    if args.json_out:
        args.json_out.write_text(json.dumps(report, indent=2), encoding='utf-8')
        print(f"Wrote JSON report to {args.json_out}")

    return 0


if __name__ == '__main__':
    raise SystemExit(main())
