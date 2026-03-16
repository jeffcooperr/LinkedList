from sqlalchemy import Column, Integer, String
from database import Base


class Job(Base):
    __tablename__ = "jobs"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    company = Column(String, nullable=False)
    location = Column(String, nullable=True)
    link = Column(String, unique=True, nullable=False, index=True)
    date_saved = Column(String, nullable=True)
    status = Column(String, nullable=False, default="Saved")
