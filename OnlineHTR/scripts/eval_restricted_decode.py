#!/usr/bin/env python3
"""Evaluate OnlineHTR checkpoint with optional restricted decode settings.

Designed for root-cause analysis on character-level custom datasets captured as CSV files
compatible with `Own_Dataset` (`<sample_name>_<label>.csv`).

Example:
    python scripts/eval_restricted_decode.py \
        --samples-dir data/own_samples \
        --model-folder models/dataIAMOnDB_featuresLinInterpol20DxDyDtN_decoderGreedy \
        --allowed-characters a,b,c \
        --max-output-chars 1
"""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path

import rootutils
import torch
from torch.utils.data import DataLoader
from torchvision.transforms import transforms

rootutils.setup_root(__file__, indicator='.project-root', pythonpath=True)

from src.data.collate_functions import ctc_loss_collator
from src.data.online_handwriting_datasets import Own_Dataset
from src.data.tokenisers import AlphabetMapper
from src.data.transforms import Carbune2020, CharactersToIndices, DictToTensor
from src.models.carbune_module import LitModule1
from src.utils.io import get_best_checkpoint_path, load_alphabet


@dataclass
class PredictionResult:
    truth: str
    prediction: str
    confidence: float


def parse_allowed_characters(raw: str) -> list[str]:
    raw = raw.strip()
    if not raw:
        return []
    return [token.strip() for token in raw.split(',') if token.strip()]


def decode_constrained_greedy(
    log_probabilities: torch.Tensor,
    alphabet_mapper: AlphabetMapper,
    allowed_characters: list[str],
    max_output_chars: int,
) -> tuple[str, float]:
    # log_probabilities shape [T, C]
    probabilities = torch.exp(log_probabilities)
    time_steps, classes = probabilities.shape

    allowed_indices: set[int] | None = None
    if allowed_characters:
        allowed_indices = {alphabet_mapper.BLANK_INDEX}
        for char in allowed_characters:
            try:
                allowed_indices.add(alphabet_mapper.character_to_index(char))
            except ValueError:
                pass

    indices: list[int] = []
    accumulated_log_prob = 0.0

    for t in range(time_steps):
        row = log_probabilities[t]
        max_idx = 0
        max_val = float('-inf')

        for c in range(classes):
            if allowed_indices is not None and c not in allowed_indices:
                continue
            value = float(row[c].item())
            if value > max_val:
                max_val = value
                max_idx = c

        indices.append(max_idx)
        accumulated_log_prob += max_val

    collapsed: list[int] = []
    prev = None
    for idx in indices:
        if idx != prev:
            collapsed.append(idx)
            prev = idx

    filtered = [idx for idx in collapsed if idx != alphabet_mapper.BLANK_INDEX]

    if max_output_chars > 0:
        filtered = filtered[:max_output_chars]

    # If constrained decode collapses to blank-only, pick best allowed non-blank class by aggregate score.
    if not filtered and allowed_indices:
        best_idx = -1
        best_score = float('-inf')
        for idx in allowed_indices:
            if idx == alphabet_mapper.BLANK_INDEX:
                continue
            score = float(log_probabilities[:, idx].sum().item())
            if score > best_score:
                best_score = score
                best_idx = idx
        if best_idx >= 0:
            filtered = [best_idx]

    text = ''.join(alphabet_mapper.index_to_character(idx) for idx in filtered)

    mean_log_prob = accumulated_log_prob / max(1, time_steps)
    confidence = max(0.0, min(1.0, float(torch.exp(torch.tensor(mean_log_prob)).item())))

    return text, confidence


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--samples-dir', type=Path, required=True)
    parser.add_argument(
        '--model-folder',
        type=Path,
        default=Path('models/dataIAMOnDB_featuresLinInterpol20DxDyDtN_decoderGreedy'),
    )
    parser.add_argument('--allowed-characters', type=str, default='')
    parser.add_argument('--max-output-chars', type=int, default=0)
    parser.add_argument('--json-out', type=Path, default=None)
    args = parser.parse_args()

    if not args.samples_dir.exists():
        print(f'ERROR: samples-dir does not exist: {args.samples_dir}')
        return 2

    checkpoint_path = get_best_checkpoint_path(args.model_folder / 'checkpoints')
    if not checkpoint_path:
        print(f'ERROR: could not resolve checkpoint under {args.model_folder / "checkpoints"}')
        return 2

    model = LitModule1.load_from_checkpoint(checkpoint_path, map_location='cpu')
    model.eval()

    alphabet = load_alphabet(args.model_folder / 'alphabet.json')
    alphabet_mapper = AlphabetMapper(alphabet)
    allowed_characters = parse_allowed_characters(args.allowed_characters)

    transform = transforms.Compose(
        [
            Carbune2020(),
            DictToTensor(['x', 'y', 't', 'n']),
            CharactersToIndices(alphabet),
        ]
    )

    dataset = Own_Dataset(args.samples_dir, transform=transform)
    if len(dataset) == 0:
        print(f'ERROR: no CSV samples found in {args.samples_dir}')
        return 2

    dataloader = DataLoader(
        dataset=dataset,
        batch_size=1,
        num_workers=0,
        pin_memory=False,
        shuffle=False,
        collate_fn=ctc_loss_collator,
    )

    predictions: list[PredictionResult] = []

    with torch.no_grad():
        for batch in dataloader:
            log_softmax = model(batch['ink'])  # [T,1,C]
            single = log_softmax[:, 0, :]
            pred_text, confidence = decode_constrained_greedy(
                single,
                alphabet_mapper,
                allowed_characters=allowed_characters,
                max_output_chars=max(0, args.max_output_chars),
            )
            truth = batch['label_str'][0]
            predictions.append(PredictionResult(truth=truth, prediction=pred_text, confidence=confidence))

    compared = len(predictions)
    exact = sum(1 for p in predictions if p.truth == p.prediction)
    accuracy = exact / compared if compared else 0.0

    confusion: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    predicted_counts: Counter[str] = Counter()
    truth_counts: Counter[str] = Counter()

    for p in predictions:
        confusion[p.truth][p.prediction] += 1
        predicted_counts[p.prediction] += 1
        truth_counts[p.truth] += 1

    report = {
        'samples_dir': str(args.samples_dir),
        'model_folder': str(args.model_folder),
        'checkpoint_path': str(checkpoint_path),
        'allowed_characters': allowed_characters,
        'max_output_chars': args.max_output_chars,
        'sample_count': compared,
        'exact_matches': exact,
        'accuracy': accuracy,
        'truth_counts': dict(truth_counts),
        'predicted_counts': dict(predicted_counts),
        'confusion_matrix': {k: dict(v) for k, v in confusion.items()},
        'mean_confidence': (sum(p.confidence for p in predictions) / compared) if compared else 0.0,
    }

    print('\n=== Restricted Decode Evaluation ===')
    print(f"Samples: {compared}")
    print(f"Exact matches: {exact}")
    print(f"Accuracy: {accuracy:.4f}")
    print(f"Truth counts: {dict(truth_counts)}")
    print(f"Predicted counts: {dict(predicted_counts)}")
    print(f"Mean confidence: {report['mean_confidence']:.6f}")
    print('Confusion matrix (truth -> predicted:count):')
    for truth in sorted(report['confusion_matrix']):
        print(f"  {truth}: {report['confusion_matrix'][truth]}")

    if args.json_out:
        args.json_out.write_text(json.dumps(report, indent=2), encoding='utf-8')
        print(f"Wrote JSON report to {args.json_out}")

    return 0


if __name__ == '__main__':
    raise SystemExit(main())
