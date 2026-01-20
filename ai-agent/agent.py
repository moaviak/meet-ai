import logging
import asyncio
import os
from dotenv import load_dotenv

from vision_agents.core import User, Agent
from vision_agents.core.agents import AgentLauncher
from vision_agents.plugins import getstream, gemini

logger = logging.getLogger(__name__)

load_dotenv()


async def create_agent(agent_id: str, agent_name: str, instructions: str, **kwargs) -> Agent:
    """
    Create an agent with custom instructions from the database.
    
    Args:
        agent_id: The unique identifier for the agent
        agent_name: The display name for the agent
        instructions: Custom instructions for the agent's behavior
    """
    agent = Agent(
        edge=getstream.Edge(),  # Use Stream for edge video transport
        agent_user=User(id=agent_id, name=agent_name),  # Use agent ID and name from DB
        instructions=instructions,  # Use custom instructions from the database
        llm=gemini.Realtime(),  # Gemini Live for voice (fps=0 for audio-only)
    )
    return agent


async def join_call(agent: Agent, call_type: str, call_id: str, **kwargs) -> None:
    """
    Join a call with the agent.
    
    Args:
        agent: The agent instance
        call_type: Type of call (e.g., "default")
        call_id: The call ID to join
    """
    logger.info(f"Agent {agent.agent_user.name} joining call {call_type}:{call_id}")
    
    call = await agent.create_call(call_type, call_id)

    # Join the call
    async with agent.join(call):
        # Initial greeting
        await agent.llm.simple_response(
            text="Hello! I'm your AI assistant. How can I help you today?"
        )
        
        # Keep the agent in the call until it ends
        await agent.finish()
        
    logger.info(f"Agent {agent.agent_user.name} left call {call_id}")


async def start_agent_for_call(
    agent_id: str,
    agent_name: str,
    instructions: str,
    call_type: str,
    call_id: str
):
    """
    Convenience function to create and join an agent to a call.
    
    This is called from the FastAPI endpoint.
    """
    agent = await create_agent(
        agent_id=agent_id,
        agent_name=agent_name,
        instructions=instructions
    )
    await join_call(agent, call_type, call_id)


if __name__ == "__main__":
    # CLI mode for testing
    cli(AgentLauncher(create_agent=create_agent, join_call=join_call))