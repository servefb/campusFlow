from typing import Optional

from pydantic import BaseModel


class page_query(BaseModel):
    page: int = 1
    page_size: int = 20
    keyword: Optional[str] = None
    range: Optional[str] = None

