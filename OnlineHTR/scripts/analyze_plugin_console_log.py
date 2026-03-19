#!/usr/bin/env python3
"""Analyze Obsidian plugin console logs for handwriting recognition quality.

Example:
    python scripts/analyze_plugin_console_log.py \
        --log-file ../.github/test1 \
        --expected a,a,a,b,b,b,c,c,c
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from statistics import mean

SUCCESS_PATTERN = re.compile(
    r"recognition success \{.*?bestText: '(?P<text>.*?)'.*?bestConfidence: (?P<confidence>[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)",
    re.IGNORECASE,
)


@dataclass
class Prediction:
    text: str
    confidence: float


def parse_expected(expected: str | None) -> list[str]:
    if not expected:
        return []
    return [token.strip() for token in expected.split(',') if token.strip()]


def parse_predictions(log_text: str) -> list[Prediction]:
    predictions: list[Prediction] = []
    for match in SUCCESS_PATTERN.finditer(log_text):
        text = match.group('text')
        confidence = float(match.group('confidence'))
        predictions.append(Prediction(text=text, confidence=confidence))
    return predictions


def build_confusion(expected: list[str], predicted: list[str]) -> dict[str, dict[str, int]]:
    matrix: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for truth, guess in zip(expected, predicted):
        matrix[truth][guess] += 1
    # Normalize defaultdicts for JSON output.
    return {truth: dict(row) for truth, row in matrix.items()}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--log-file', type=Path, required=True, help='Path to captured plugin console log text file.')
    parser.add_argument(
        '--expected',
        type=str,
        default='',
        help='Comma-separated expected labels in draw order, e.g. a,a,a,b,b,b,c,c,c',
    )
    parser.add_argument(
        '--json-out',
        type=Path,
        default=None,
        help='Optional output path for machine-readable JSON summary.',
    )
    args = parser.parse_args()

    log_text = args.log_file.read_text(encoding='utf-8')
    predictions = parse_predictions(log_text)
    expected = parse_expected(args.expected)

    predicted_texts = [p.text for p in predictions]
    confidences = [p.confidence for p in predictions]

    summary: dict[str, object] = {
        'log_file': str(args.log_file),
        'prediction_count': len(predictions),
        'predicted_text_counts': dict(Counter(predicted_texts)),
        'confidence': {
            'mean': mean(confidences) if confidences else None,
            'min': min(confidences) if confidences else None,
            'max': max(confidences) if confidences else None,
        },
    }

    if expected:
        compared = min(len(expected), len(predicted_texts))
        exact_matches = sum(1 for i in range(compared) if expected[i] == predicted_texts[i])
        accuracy = exact_matches / compared if compared else 0.0

        summary.update(
            {
                'expected_count': len(expected),
                'compared_count': compared,
                'exact_matches': exact_matches,
                'accuracy': accuracy,
                'confusion_matrix': build_confusion(expected[:compared], predicted_texts[:compared]),
            }
        )

        if len(expected) != len(predicted_texts):
            summary['length_mismatch_warning'] = (
                f'Expected {len(expected)} labels but found {len(predicted_texts)} predictions. '
                f'Compared first {compared} entries.'
            )

    print('\n=== Recognition Log Analysis ===')
    print(f"Log file: {args.log_file}")
    print(f"Predictions found: {len(predictions)}")
    if confidences:
        print(
            f"Confidence: mean={summary['confidence']['mean']:.6f}, "
            f"min={summary['confidence']['min']:.6f}, max={summary['confidence']['max']:.6f}"
        )
    print(f"Predicted counts: {dict(Counter(predicted_texts))}")

    if expected:
        print('\n--- Ground Truth Comparison ---')
        print(f"Compared: {summary['compared_count']} samples")
        print(f"Exact matches: {summary['exact_matches']}")
        print(f"Accuracy: {summary['accuracy']:.4f}")
        if 'length_mismatch_warning' in summary:
            print(f"Warning: {summary['length_mismatch_warning']}")

        print('\nConfusion matrix (truth -> predicted:count):')
        confusion = summary.get('confusion_matrix', {})
        for truth in sorted(confusion):
            print(f"  {truth}: {confusion[truth]}")

    if args.json_out:
        args.json_out.write_text(json.dumps(summary, indent=2), encoding='utf-8')
        print(f"\nWrote JSON summary to {args.json_out}")

    return 0


if __name__ == '__main__':
    raise SystemExit(main())
