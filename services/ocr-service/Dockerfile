FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libgl1 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY services/ocr-service/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY services/ocr-service/app.py ./

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8090"]
