from io import BytesIO
from typing import Any

import base64
import re

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException
from paddleocr import PaddleOCR
from PIL import Image
from pydantic import BaseModel


app = FastAPI(title="ocr-service")
ocr = PaddleOCR(use_angle_cls=True, lang="en")

DIM_PATTERN = re.compile(r"\d{1,4}\s*[xX*]\s*\d{1,4}(?:\s*[xX*]\s*\d{1,4})?")
QTY_PATTERN = re.compile(r"\b\d{1,3}\s*(?:ad|adet|a[dl1i]\.?)\b", re.IGNORECASE)
SERIES_PATTERN = re.compile(r"\b(?:[1-9]\d{3})\b")
FUZZY_TRIPLE_PATTERN = re.compile(r"\b\d{1,4}\D{0,8}\d{1,4}\D{0,8}\d{1,4}\b")
NOISE_PATTERN = re.compile(
    r"(whatsapp|iletildi|carsamba|gunaydin|mesaj|mailden|tamamdir|polinet|lte)",
    re.IGNORECASE,
)


class OcrRequest(BaseModel):
    contentBase64: str
    fileName: str | None = None
    mimeType: str | None = None


def decode_image(content_base64: str) -> np.ndarray:
    try:
        data = base64.b64decode(content_base64)
        image = Image.open(BytesIO(data)).convert("RGB")
        return cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"invalid image payload: {exc}") from exc


def normalize_line(text: str) -> str:
    text = text.strip()
    text = text.replace(chr(215), "x").replace("*", "x")
    text = text.replace("/", "x").replace("\\", "x")
    text = re.sub(r"(?<=\d)\s*[Xx]\s*(?=\d)", "x", text)
    text = re.sub(r"(?<=\d)[Il|](?=\d)", "1", text)
    text = re.sub(r"\blox\b", "10x", text, flags=re.IGNORECASE)
    text = re.sub(r"\b1Sx\b", "15x", text)
    text = re.sub(r"\bSsx\b", "55x", text, flags=re.IGNORECASE)
    text = re.sub(r"\bA[l1I]\b", "Ad", text, flags=re.IGNORECASE)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def detect_paper_region(image: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    _, thresh = cv2.threshold(blur, 180, 255, cv2.THRESH_BINARY)
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    height, width = image.shape[:2]
    image_area = height * width
    best_rect = None
    best_score = 0.0

    for contour in contours:
        x, y, w, h = cv2.boundingRect(contour)
        area = w * h
        if area < image_area * 0.08:
            continue
        aspect_penalty = abs((w / max(h, 1)) - 0.75)
        center_y = y + h / 2
        lower_bias = center_y / max(height, 1)
        score = area * (1.0 - min(aspect_penalty, 1.5) * 0.2) * (0.7 + lower_bias)
        if score > best_score:
            best_rect = (x, y, w, h)
            best_score = score

    if not best_rect:
        return image

    x, y, w, h = best_rect
    pad_x = int(w * 0.05)
    pad_y = int(h * 0.05)
    x1 = max(0, x - pad_x)
    y1 = max(0, y - pad_y)
    x2 = min(width, x + w + pad_x)
    y2 = min(height, y + h + pad_y)
    return image[y1:y2, x1:x2]


def build_candidate_crops(image: np.ndarray) -> list[np.ndarray]:
    height, width = image.shape[:2]
    paper = detect_paper_region(image)
    ph, pw = paper.shape[:2]

    crops = [paper, image]

    # WhatsApp-like screenshots: note is generally in the lower-middle area.
    y1 = int(height * 0.20)
    y2 = int(height * 0.88)
    x1 = int(width * 0.08)
    x2 = int(width * 0.92)
    crops.append(image[y1:y2, x1:x2])

    # Center/lower focus inside the detected paper.
    py1 = int(ph * 0.18)
    py2 = int(ph * 0.95)
    px1 = int(pw * 0.05)
    px2 = int(pw * 0.95)
    crops.append(paper[py1:py2, px1:px2])

    # Aggressive focus for small handwriting.
    py3 = int(ph * 0.28)
    py4 = int(ph * 0.98)
    px3 = int(pw * 0.10)
    px4 = int(pw * 0.92)
    crops.append(paper[py3:py4, px3:px4])

    return [crop for crop in crops if crop.size > 0]


def preprocess_variants(image: np.ndarray) -> list[np.ndarray]:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    denoised = cv2.fastNlMeansDenoising(gray, h=15)
    enhanced = cv2.convertScaleAbs(denoised, alpha=1.5, beta=8)
    binary = cv2.adaptiveThreshold(
        enhanced,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        31,
        11,
    )
    inverted = 255 - binary
    otsu = cv2.threshold(enhanced, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]
    return [gray, enhanced, binary, inverted, otsu]


def build_scaled_variants(image: np.ndarray) -> list[np.ndarray]:
    variants = [image]
    h, w = image.shape[:2]
    min_dim = min(h, w)
    for scale in (1.4, 1.8, 2.2):
        if min_dim * scale > 2600:
            continue
        resized = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
        variants.append(resized)
    return variants


def extract_lines(image: np.ndarray) -> list[str]:
    result: list[Any] = ocr.ocr(image, cls=True)
    if not result or not result[0]:
        return []

    items = []
    for line in result[0]:
        box, payload = line
        text, confidence = payload
        if not text or confidence < 0.10:
            continue
        top = min(point[1] for point in box)
        items.append((top, normalize_line(text)))

    items.sort(key=lambda item: item[0])
    return [text for _, text in items if text]


def score_lines(lines: list[str]) -> int:
    score = 0
    for line in lines:
        if DIM_PATTERN.search(line):
            score += 5
        if FUZZY_TRIPLE_PATTERN.search(line):
            score += 2
        if QTY_PATTERN.search(line):
            score += 4
        if SERIES_PATTERN.search(line):
            score += 2
        if len(line) >= 6:
            score += 1
    return score


def line_numeric_density(line: str) -> int:
    return len(re.findall(r"\d{1,4}", line))


def is_order_like_line(line: str) -> bool:
    normalized = normalize_line(line)
    if not normalized:
        return False
    if NOISE_PATTERN.search(normalized) and not DIM_PATTERN.search(normalized):
        return False
    if DIM_PATTERN.search(normalized):
        return True
    if FUZZY_TRIPLE_PATTERN.search(normalized) and (
        QTY_PATTERN.search(normalized) or "-" in normalized or line_numeric_density(normalized) >= 3
    ):
        return True
    return False


def normalize_line_key(line: str) -> str:
    normalized = normalize_line(line).lower()
    return re.sub(r"[^a-z0-9]+", "", normalized)


def best_ocr_text(image: np.ndarray) -> list[str]:
    best_lines: list[str] = []
    best_score = -1
    all_results: list[tuple[int, list[str]]] = []

    for crop in build_candidate_crops(image):
        for variant in preprocess_variants(crop):
            for scaled in build_scaled_variants(variant):
                lines = extract_lines(scaled)
                if not lines:
                    continue
                score = score_lines(lines)
                all_results.append((score, lines))
                if score > best_score or (score == best_score and len(lines) > len(best_lines)):
                    best_lines = lines
                    best_score = score

    if not all_results:
        return []

    merged_lines: list[str] = []
    seen = set()

    for line in best_lines:
        key = normalize_line_key(line)
        if key and key not in seen:
            merged_lines.append(line)
            seen.add(key)

    for score, lines in sorted(all_results, key=lambda item: (item[0], len(item[1])), reverse=True):
        if score < max(best_score - 3, 0):
            continue
        for line in lines:
            if not is_order_like_line(line):
                continue
            key = normalize_line_key(line)
            if not key or key in seen:
                continue
            merged_lines.append(line)
            seen.add(key)

    return merged_lines if len(merged_lines) >= len(best_lines) else best_lines


@app.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}


@app.post("/ocr")
def ocr_endpoint(payload: OcrRequest) -> dict[str, Any]:
    image = decode_image(payload.contentBase64)
    lines = best_ocr_text(image)
    return {
        "text": "\n".join(lines).strip(),
        "lines": lines,
        "lineCount": len(lines),
    }

