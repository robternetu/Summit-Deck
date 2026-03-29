# Valorant Agent Images

This folder contains agent portrait images used throughout the application.

## Image Requirements

- **Format**: PNG with transparent background (recommended)
- **Size**: 256x256 pixels or larger (images will be scaled down)
- **Naming**: Lowercase agent name (e.g., `jett.png`, `kayo.png`)

## Required Agent Images

Download and place the following agent images in this folder:

### Duelists
- `jett.png`
- `phoenix.png`
- `reyna.png`
- `yoru.png`
- `neon.png`
- `iso.png`

### Controllers
- `omen.png`
- `brimstone.png`
- `viper.png`
- `astra.png`
- `harbor.png`
- `clove.png`

### Initiators
- `sova.png`
- `breach.png`
- `skye.png`
- `kayo.png`
- `fade.png`
- `gekko.png`

### Sentinels
- `sage.png`
- `cypher.png`
- `killjoy.png`
- `chamber.png`
- `deadlock.png`
- `vyse.png`

## Where to Download

**Official Valorant Press Kit:**
https://playvalorant.com/en-us/news/announcements/valorant-press-kit/

**Alternative Sources:**
- Valorant Wiki: https://valorant.fandom.com/wiki/Agents
- Liquipedia: https://liquipedia.net/valorant/Portal:Agents
- Official Riot API assets

## Fallback Behavior

If an agent image is not found, the component will automatically display a colored circle with the agent's first letter as a fallback.

## Example File Structure

```
public/agents/
├── README.md
├── jett.png
├── omen.png
├── brimstone.png
├── phoenix.png
├── sage.png
├── sova.png
├── viper.png
├── cypher.png
├── reyna.png
├── killjoy.png
├── breach.png
├── skye.png
├── yoru.png
├── astra.png
├── kayo.png
├── chamber.png
├── neon.png
├── fade.png
├── harbor.png
├── gekko.png
├── deadlock.png
├── iso.png
├── clove.png
└── vyse.png
```

## Usage in Code

The `AgentImage` component automatically maps agent names to these images:

```tsx
import { AgentImage } from '@/components/ui/AgentImage'

// Usage
<AgentImage agent="jett" size="md" />
```
