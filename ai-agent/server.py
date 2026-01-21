import asyncio
import logging
from fastapi import FastAPI, BackgroundTasks, HTTPException
from pydantic import BaseModel
import uvicorn

from agent import start_agent_for_call

#------------------------------------------------------------------------------------
# Start the server with: uvicorn server:app --host 0.0.0.0 --port 8000 --reload
#------------------------------------------------------------------------------------

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="AI Agent Service")

# Store active agent tasks
active_agents = {}


class JoinCallRequest(BaseModel):
    """Request to join an agent to a call"""
    agent_id: str
    agent_name: str
    instructions: str
    call_type: str = "default"
    call_id: str


class LeaveCallRequest(BaseModel):
    """Request to remove an agent from a call"""
    call_id: str


@app.post("/agent/join")
async def join_agent_to_call(request: JoinCallRequest, background_tasks: BackgroundTasks):
    """
    Trigger an agent to join a call.
    
    This endpoint is called by the Next.js webhook when a call starts.
    """
    call_id = request.call_id
    
    if call_id in active_agents:
        raise HTTPException(status_code=400, detail="Agent already active for this call")
    
    logger.info(f"Starting agent {request.agent_id} for call {call_id}")
    
    # Create a task to run the agent in the background
    task = asyncio.create_task(
        start_agent_for_call(
            agent_id=request.agent_id,
            agent_name=request.agent_name,
            instructions=request.instructions,
            call_type=request.call_type,
            call_id=call_id
        )
    )
    
    active_agents[call_id] = task
    
    # Clean up when task completes
    def cleanup_task(call_id: str):
        if call_id in active_agents:
            del active_agents[call_id]
            logger.info(f"Cleaned up agent task for call {call_id}")
    
    task.add_done_callback(lambda t: cleanup_task(call_id))
    
    return {
        "status": "success",
        "message": f"Agent {request.agent_id} joining call {call_id}",
        "call_id": call_id
    }


@app.post("/agent/leave")
async def remove_agent_from_call(request: LeaveCallRequest):
    """
    Remove an agent from a call.
    
    This endpoint is called when a call ends or when the agent should leave.
    """
    call_id = request.call_id
    
    if call_id not in active_agents:
        return {"status": "success", "message": "No active agent for this call"}
    
    # Cancel the agent task
    task = active_agents[call_id]
    task.cancel()
    
    del active_agents[call_id]
    
    logger.info(f"Agent removed from call {call_id}")
    
    return {
        "status": "success",
        "message": f"Agent removed from call {call_id}",
        "call_id": call_id
    }


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "active_agents": len(active_agents)
    }


@app.get("/agent/status")
async def get_agent_status():
    """Get status of all active agents"""
    return {
        "active_calls": list(active_agents.keys()),
        "total_active": len(active_agents)
    }


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)