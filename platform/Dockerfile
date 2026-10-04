FROM python:3.13-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PORT=8000 PYTHONPATH=/app/src
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && useradd --uid 10001 --create-home app
COPY src ./src
COPY public ./public
RUN chown -R app:app /app
USER 10001
EXPOSE 8000
CMD ["python", "-m", "fmc", "serve"]
