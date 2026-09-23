from src.api import agent_router
from src.models.meassage import Message
router = agent_router.router

@router.post("/messages/stream")
async def stream_messages(message: Message):
    """
    Endpoint to stream messages in real-time.
    """

    return {"message": "Streaming messages..."}






