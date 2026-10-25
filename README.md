# Walking reach, central Weimar

A 3D model of central Weimar that shows how far you can walk from any point, and about how many people live there.

The buildings stand at their measured heights, coloured by their main use. Click the ground and the app walks the pedestrian network for 5, 10 and 15 minutes. It draws the three areas in three shades of one colour, and highlights the buildings that touch each area in the matching shade. A panel lists, for each walk, the number of buildings reached and about how many residents live in the area.

Live site: https://yhemayll.github.io/latent-intuition/

## Run it

```
npm install     install the packages
npm run dev     start the app at http://localhost:5173
```

Drag to orbit, right-drag to pan, scroll to zoom. Click the ground to start a walk.

## Method and limits

- **Start.** The walk starts at the walkable node of the street network nearest to the click. If no walkable street is within 100 m, the app says so and draws no walk.
- **Walking speed.** 4.8 km/h, which is 80 m a minute: 400, 800 and 1,200 m along the network, using each edge's `length` in metres. Walking is the same speed everywhere: no slopes, stairs, crossings or waiting at lights.
- **Areas.** Each area is the street segments reached in that time, including the reachable part of the last segment, with a band of 25 m on each side, joined into one shape. It is not a circle and not a convex hull. The 25 m band is a choice, not a measured distance to doors.
- **Buildings.** A building counts when its footprint touches the area. A large building can count even if most of it lies outside.
- **Residents.** From the 100 m cells of the Zensus 2022. Every cell that overlaps the area adds its population times the share of the cell's area that lies inside, as if residents were spread evenly over each cell. The sum is rounded to the nearest 10. The census changes small counts slightly at random to protect privacy, so the figures are approximate.
- **Missing figures.** Some cells have no published population (`null`). They are not zero: they are left out of the sum, and the panel shows how many such cells overlap the area.
- **Edge of the kit.** The data stops at the kit boundary. A walk near the edge reaches less than it would in the real city.

## Data sources

All data is in `public/data/`; `SOURCES.md` there describes every file and field.

| Data | Source | Licence |
| --- | --- | --- |
| Building footprints and heights | 3D building models LoD2 of Thuringia, © GDI-Th; floors and uses added by Egor Gaydukov | dl-de/by-2-0 |
| Pedestrian network | Egor Gaydukov, InfAU, Bauhaus-Universität Weimar | |
| Census grid, 100 m | Zensus 2022, © Statistische Ämter des Bundes und der Länder | dl-de/by-2-0 |

Buildings: 3D building models LoD2 © GDI-Th (dl-de/by-2-0). Land use and pedestrian network: Egor Gaydukov, InfAU, Bauhaus-Universität Weimar. Census grid: Zensus 2022, © Statistische Ämter des Bundes und der Länder (dl-de/by-2-0).

## How this was made

1. Tools: Claude Code, with the model Claude Opus 5.5.
2. I decided:
3. The agent did: read the city kit, then wrote the 3D view, the walking and resident calculations, the panel and this README, and tested the calculations against the data.
4. I checked:
