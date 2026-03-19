# OnlineHTR Root-Cause Analysis Plan

**Status**: Phase 0/1/2 Tools Ready  
**Current Problem**: Single-character benchmark (a,a,a,b,b,b,c,c,c) yields 4/9 accuracy (44%)  
**Goal**: Systematic evidence-based diagnosis of failure modes

## Executive Summary

The current implementation shows poor performance on single-character inputs (44% accuracy on a,b,c). This plan executes a structured analysis to isolate the root cause(s) among:
1. **Domain mismatch**: Training on full lines vs testing on single characters
2. **Preprocessing divergence**: Plugin preprocessing != Carbune2020 contract
3. **Model behavior**: Blank dominance, class collapse under restricted alphabet
4. **Export/runtime parity**: ONNX vs PyTorch behavior
5. **Decoder policy**: Greedy decoding limitations under constraints
6. **Calibration**: Confidence scores not aligned with accuracy

---

## Analysis Phases

### Phase 0: Baseline Scope & Repro Gate ✅
**Status**: COMPLETE

**Deliverables**:
- [x] Environment spec (Python 3.10, PyTorch 2.0+, Lightning 2.0+)
- [x] Canonical training recipe documented
- [x] IAM-OnDB dataset structure confirmed
- [x] Preprocessing contract (Carbune2020) extracted
- [x] Decoder design (GreedyCTC) understood
- [x] Alphabet & CTC blank semantics (blank=index 0)

**Key Findings**:
- Model trained on full lines with (dx, dy, dt, n) features
- Linear interpolation @ 20 points/unit length
- CTC blank insertion at index 0 in alphabet mapping
- Greedy decoder: argmax → unique_consecutive → filter blank

**Repro Gate Status**: ✅ PASS
- Baseline commands runnable
- Checkpoint loads successfully
- Test log analysis working

---

### Phase 1: Data/Preprocessing Contract Audit 🔄
**Status**: IN PROGRESS

**Deliverables**:
- [ ] Detailed preprocessing formula document
- [x] Preprocessing validation script (`preprocess_validation.py`)
- [ ] IAM-OnDB vs plugin input distribution comparison
- [ ] Mismatch matrix (stroke count, sequence length, temporal properties)
- [ ] Evidence report: domain gap quantified

**Tools**:
```bash
make preprocess-validation LIMIT=100
```

**What to check**:
1. Plugin extracts (dx, dy, dt, n) correctly?
2. Plugin applies same coordinate normalization?
3. Plugin resamples to 20 pts/unit length?
4. Input distribution (plugin) vs training distribution (IAM-OnDB)?
   - Stroke count: single-char (1-2 strokes) vs lines (10+ strokes)
   - Sequence length: single-char (~50-150 pts) vs lines (~300+ pts)
   - Time gaps: uniform or variable?
   - Character frequency: single-char bias vs balanced

**Expected output**: 
- Pass/fail per preprocessing step
- Distribution snapshot (lengths, strokes, time patterns)
- Root cause evidence: is domain mismatch the culprit?

---

### Phase 2: Model/Decoder Behavior Analysis 🔄
**Status**: IN PROGRESS

**Deliverables**:
- [x] Logits diagnostics script (`logits_diagnostics.py`)
- [ ] Blank dominance quantified on plugin test cases
- [ ] Class collapse analysis (probability mass concentration)
- [ ] Top-k entropy analysis (per-class, per-timestep)
- [ ] Confusion matrix (a,b,c restricted alphabet)
- [ ] Evidence: model output behavior under single-char constraint?

**Tools**:
```bash
make logits-diagnostics \
  CHECKPOINT=models/dataIAMOnDB_.../best.ckpt \
  SAMPLES_DIR=data/own_samples \
  RESTRICTED=a,b,c
```

**What to measure**:
1. **Blank dominance**: % of timesteps where blank=argmax
   - Hypothesis: high blank rate → blank collapse in output
2. **Per-class probability mass**: 
   - Is 'a' always highest? (class bias)
   - Are b/c modes suppressed? (training imbalance)
3. **Entropy per timestep**:
   - Low entropy = confident model (possibly overfit to 'a')
   - High entropy = uncertain (could go either way)
4. **Top-k concentration**:
   - top1_mass >> top3_mass = overconfident
5. **Restricted decoding result**:
   - Under (a,b,c) only, what does greedy output?

**Expected output**:
- Blank dominance % (target: <20% normal, >40% suspicious)
- Per-class argmax frequency (target: balanced ~33% each, imbalance culprit)
- Entropy stats (target: high when uncertain)
- Confusion matrix (target: diagonal dominant)

---

### Phase 3: Export/Runtime Parity Validation
**Status**: PLANNED

**Deliverables**:
- [ ] PyTorch vs ONNX parity test (on identical preprocessed inputs)
- [ ] Per-sample confidence calibration plot (predicted conf vs observed accuracy)
- [ ] ONNX output shape and numerical tolerance check
- [ ] Runtime vs offline batch inference comparison

**Tools** (to implement):
```bash
make export-parity-test \
  CHECKPOINT=models/.../best.ckpt \
  SAMPLE_CSV=data/sample.csv
```

**What to check**:
1. ONNX export produces identical logits as PyTorch?
2. Plugin (web-based ONNX) matches offline PyTorch?
3. Confidence proxy (softmax) vs true accuracy calibrated?

---

### Phase 4: Evaluation Deep-Dive & Confusion Matrices
**Status**: PLANNED

**Deliverables**:
- [ ] Benchmark results for three buckets: line-level, word-level, single-char
- [ ] CER/WER metrics plus blank output frequency
- [ ] Single-character confusion matrix (a,b,c and larger alphabets)
- [ ] Constrained vs unconstrained decoding comparison

**Tools** (use existing + new):
```bash
# Log analysis (existing)
make analyze-plugin-log LOG_FILE=.github/test1 EXPECTED=a,a,a,b,b,b,c,c,c

# Restricted decode on CSV samples
make eval-restricted SAMPLES_DIR=data/own_samples ALLOWED=a,b,c MAX_OUTPUT=1

# Logits diagnostics (new)
make logits-diagnostics CHECKPOINT=... SAMPLES_DIR=...
```

**Expected output**:
- Accuracy table (line CER, word WER, char accuracy)
- Confusion matrix concentration (diagonal dominance metric)
- Blank rate distribution
- Confidence vs accuracy calibration plot

---

### Phase 5: Root Cause Synthesis & Decision Tree
**Status**: PLANNED

**Deliverables**:
- [ ] Ranked root causes with evidence links
- [ ] Remediation tracks (cost vs impact)
- [ ] Go/no-go decision thresholds for production
- [ ] Unsupported use cases explicitly marked

**Root causes to rank**:
1. **Domain mismatch** (training=lines, test=chars)
   - Evidence: Phase 1 distribution mismatch
   - Impact: High (model never saw single-char data)
   - Fix: Rebalance training data or fine-tune on char-level

2. **Preprocessing divergence** (plugin != Carbune2020)
   - Evidence: Phase 1 validation output
   - Impact: Medium (could silently break logits)
   - Fix: Align plugin preprocessing to contract

3. **Blank dominance** (CTC blank overfit)
   - Evidence: Phase 2 blank dominance % and class frequency
   - Impact: Medium (causes output collapse)
   - Fix: Adjust blank weight in CTC loss or post-process

4. **Class imbalance** (model biased to 'a')
   - Evidence: Phase 2 per-class probability mass and confusion matrix
   - Impact: High (systematic error pattern)
   - Fix: Rebalance training data or apply focal loss

5. **Calibration mismatch** (confidence unreliable)
   - Evidence: Phase 3 confidence vs accuracy plot
   - Impact: Low (UX only, not accuracy)
   - Fix: Temperature scaling, Platt scaling

6. **Export/runtime drift** (ONNX != PyTorch)
   - Evidence: Phase 3 parity test results
   - Impact: Critical if present (silent failure)
   - Fix: Retrain ONNX export or validate round-trip

**Decision tree**:
```
IF blank_dominance > 40%:
  → Blank collapse is culprit → Adjust CTC loss or post-process
ELSE IF class_imbalance (confident on 'a', low on b/c):
  → Class bias culprit → Rebalance training data or focal loss
ELSE IF entropy_high AND top1_mass_low:
  → Model uncertain on single-chars (domain) → Fine-tune on chars
ELSE IF ONNX_parity_fail:
  → Export divergence → Retrain export
ELSE:
  → Multiple correlated issues → Staged remediation
```

---

## Workflow: How to Execute

### Quick Start (validate Phase 0 tools work)
```bash
# Terminal 1: Run dev server
cd tldraw-handwriting-rec-plugin-obsidian
npm run dev

# Terminal 2: In OnlineHTR, test Phase 0/1 tools
cd OnlineHTR

# Analyze existing plugin log
make analyze-plugin-log LOG_FILE=../.github/test1 EXPECTED=a,a,a,b,b,b,c,c,c

# Profile dataset distribution
make profile-iamondb DATASET_ROOT=data/datasets/IAM-OnDB LIMIT=100

# Validate preprocessing (first 50 samples)
make preprocess-validation LIMIT=50
```

### Phase 1: Preprocessing Audit
```bash
# Generate preprocessing contract validation on core dataset
make preprocess-validation LIMIT=200 > phase1_preprocessing_report.txt

# Visually inspect: which samples fail? what patterns?
# Compare plugin logs to expected Carbune2020 contract
```

### Phase 2: Model Behavior Analysis
```bash
# Point to your checkpoint (download or train)
CKPT="models/dataIAMOnDB_featuresLinInterpol20DxDyDtN_decoderGreedy/best.ckpt"

# Create sample CSV in plugin log format (t, x, y, stroke_id) for known failures
# (manually extract from plugin logs or synthetic test cases)

# Run logits diagnostics
make logits-diagnostics \
  CHECKPOINT=$CKPT \
  SAMPLES_DIR=data/samples \
  RESTRICTED=a,b,c \
  --json-output logits_report.json

# Inspect report for:
# - blank_dominance > 40%?
# - class frequencies biased?
# - entropy low (overconfident)?
```

### Phase 3+: Runtime Validation & Synthesis
- See Phase 3/4/5 deliverables above
- Tools TBD based on Phase 1/2 findings

---

## Success Criteria

| Phase | Criterion | Status |
|-------|-----------|--------|
| 0 | Baseline runnable, logs parse | ✅ |
| 1 | Preprocessing validated, mismatch quantified | 🔄 |
| 2 | Model behavior diagnosed (blank, class imbalance) | 🔄 |
| 3 | ONNX parity verified or drift detected | ⏳ |
| 4 | Confusion matrices show systematic failure pattern | ⏳ |
| 5 | Root cause ranked + remediation plan + go/no-go | ⏳ |

---

## Files & References

**Key Sources**:
- `src/data/transforms.py` — Carbune2020 preprocessing
- `src/data/tokenisers.py` — AlphabetMapper (CTC blank insertion)
- `src/utils/decoders.py` — GreedyCTCDecoder
- `src/models/carbune_module.py` — LitModule1 architecture
- `tests/test_IAM_OnDB_Dataset_Carbune2020.py` — Preprocessing test

**Analysis Tools** (in `scripts/`):
- `analyze_plugin_console_log.py` — Parse plugin logs ✅
- `profile_iamondb_dataset.py` — Data distribution ✅
- `eval_restricted_decode.py` — Restrict alphabet testing ✅
- `logits_diagnostics.py` — Model behavior analysis 🆕
- `preprocess_validation.py` — Preprocessing contract audit 🆕

**Makefile targets**:
- `analyze-plugin-log` ✅
- `profile-iamondb` ✅
- `eval-restricted` ✅
- `logits-diagnostics` 🆕
- `preprocess-validation` 🆕

---

## Next Immediate Steps

1. **Run Phase 1 validation** on 50-100 IAM-OnDB samples
   ```bash
   make preprocess-validation LIMIT=100
   ```

2. **Prepare Phase 2 test data**: Extract single-character samples from plugin logs
   - Convert plugin log entries (x, y, timestamps) → CSV format (t, x, y, stroke_id)
   - Save in `data/samples/` for logits diagnostics

3. **If checkpoint available**: Run Phase 2 logits diagnostics
   ```bash
   make logits-diagnostics CHECKPOINT=... SAMPLES_DIR=data/samples
   ```

4. **Synthesize Phase 1/2 findings** into root-cause hypothesis
   - E.g., "80% blank dominance + imbalanced to 'a' = Phase 1 domain mismatch + Phase 2 class bias"

5. **Plan remediation** based on top root cause
   - Domain mismatch → Fine-tune on single-character data
   - Preprocessing divergence → Fix plugin preprocessing
   - Blank/class bias → Adjust CTC loss or post-processing

---

**Document Version**: 0.2  
**Last Updated**: Phase 0/1/2 tools ready, Phase 3-5 TBD  
**Owner**: Root-Cause Analysis Task Force
