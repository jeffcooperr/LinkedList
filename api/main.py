from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

import models
import schemas
from database import Base, engine, get_db

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Job Tracker API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Chrome extensions send requests from chrome-extension:// origins
    allow_methods=["POST"],
    allow_headers=["Content-Type"],
)


@app.post("/jobs", response_model=schemas.JobResponse, status_code=201)
def create_job(job: schemas.JobCreate, db: Session = Depends(get_db)):
    existing = db.query(models.Job).filter(models.Job.link == job.link).first()
    if existing:
        raise HTTPException(status_code=409, detail="Job already tracked")

    db_job = models.Job(
        title=job.title,
        company=job.company,
        location=job.location,
        link=job.link,
        date_saved=job.date_saved,
        status="Saved",
    )
    db.add(db_job)
    db.commit()
    db.refresh(db_job)
    return db_job
