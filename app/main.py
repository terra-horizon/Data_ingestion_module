from fastapi import FastAPI

from app.api.routes.ingestion import router as ingestion_router


app = FastAPI(
    title="Data Ingestion Service",
    description="Minimal API foundation for the TERRA data ingestion module.",
    version="0.1.0",
)

app.include_router(ingestion_router, prefix="/api")
