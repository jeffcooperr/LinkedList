from pydantic import BaseModel
from typing import Optional


class JobCreate(BaseModel):
    title: str
    company: str
    location: Optional[str] = None
    link: str
    date_saved: Optional[str] = None


class JobResponse(BaseModel):
    id: int
    title: str
    company: str
    location: Optional[str]
    link: str
    date_saved: Optional[str]
    status: str

    model_config = {"from_attributes": True}
