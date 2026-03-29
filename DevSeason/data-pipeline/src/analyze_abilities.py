"""
Analyze ability events from GRID data to understand structure.
"""
import json
from pathlib import Path
from collections import defaultdict

# Use the grid_events_reader from the same directory
import sys
sys.path.insert(0, str(Path(__file__).parent))
from grid_events_reader import iter_messages


def analyze_abilities(events_path: Path, max_events: int = 100):
    """Analyze ability event structure."""
    
    ability_events = []
    agent_abilities = defaultdict(set)
    ability_structure = {}
    
    for message in iter_messages(events_path, max_lines=5000):
        for event in message.get("events", []):
            if event.get("type") != "player-used-ability":
                continue
            
            ability_events.append(event)
            
            # Extract structure
            actor = event.get("actor", {})
            actor_state = actor.get("state", {})
            ability = actor.get("ability", {})
            character = actor_state.get("character", {})
            
            agent_name = character.get("name", "unknown")
            ability_id = ability.get("id", "unknown")
            ability_name = ability.get("name", "unknown")
            
            agent_abilities[agent_name].add(f"{ability_name} ({ability_id})")
            
            if len(ability_events) >= max_events:
                break
        
        if len(ability_events) >= max_events:
            break
    
    return ability_events, agent_abilities


def main():
    events_path = Path("E:/A-c9-StratOS/grid-cache/hot/2024/tournaments/757073/series/2629390/events.jsonl")
    
    print("=" * 80)
    print("ABILITY EVENT ANALYSIS")
    print("=" * 80)
    print()
    
    events, agent_abilities = analyze_abilities(events_path, max_events=200)
    
    print(f"Analyzed {len(events)} ability events")
    print()
    
    # Print first 3 full events
    print("=" * 80)
    print("SAMPLE EVENTS (first 3)")
    print("=" * 80)
    for i, evt in enumerate(events[:3]):
        print(f"\nEvent {i+1}:")
        print(json.dumps(evt, indent=2))
    
    print()
    print("=" * 80)
    print("ABILITIES BY AGENT")
    print("=" * 80)
    for agent, abilities in sorted(agent_abilities.items()):
        print(f"\n{agent}:")
        for ability in sorted(abilities):
            print(f"  - {ability}")


if __name__ == "__main__":
    main()
