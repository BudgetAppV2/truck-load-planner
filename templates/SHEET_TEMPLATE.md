# Google Sheet Template

## Quick Start
1. Create a new Google Sheet
2. Add the columns below (copy the header row)
3. Fill in your cases with dimensions in inches
4. Publish: File > Share > Publish to web > Sheet > CSV > Publish
5. Copy the sheet URL and paste it in the app

## Required Columns

| nom | largeur | profondeur | hauteur |
|-----|---------|------------|---------|
| Case name | Width (inches) | Depth (inches) | Height (inches) |

**That's it.** These 4 columns are all you need for basic optimization.

## Optional Columns (add as needed)

| Column | What it does | Values |
|--------|-------------|--------|
| dept | Department — groups cases by color in 3D | Any text: `LX`, `SON`, `STAGE`, etc. |
| qty | Quantity — duplicates the case N times | Number: `1`, `3`, `6` |
| stackable | Allow stacking other cases on top | `oui`, `yes`, `true`, `1` |
| max_stack | Maximum stack height | Number: `2`, `3` |
| is_floor | Floor panel — loads first at back of truck | `oui`, `yes`, `true`, `1` |
| allow_rotation | Can the solver rotate this case 90°? | `oui`, `yes`, `true`, `1` (default: yes) |
| group | Group name — cases with same group stay together | Any text |
| camion | Truck number (for multi-truck setups) | Number: `1`, `2` |

## Dimension Guide

```
         ┌─────────── largeur (width) ───────────┐
         │                                        │
         │    ┌─────────────────────────┐   ▲     │
         │    │                         │   │     │
         │    │       CASE              │   │ hauteur (height)
         │    │       (front view)      │   │     │
         │    │                         │   │     │
         │    └─────────────────────────┘   ▼     │
         │                                        │
         └────────────────────────────────────────┘

    largeur = the side that faces the truck side wall
    profondeur = how far the case extends into the truck (front to back)
    hauteur = how tall the case is
```

## Example: Theater Production

| nom | largeur | profondeur | hauteur | dept | qty | stackable |
|-----|---------|------------|---------|------|-----|-----------|
| Alpha spot | 31 | 29 | 36 | LX | 3 | oui |
| Sound console | 38 | 20 | 48 | SON | 1 | non |
| LX console | 44 | 30 | 18 | LX | 2 | oui |
| Cable trunk | 44 | 30 | 36 | LX | 2 | non |
| Monitor wedge | 31 | 24 | 32 | SON | 4 | oui |
| Floor panel | 45 | 100 | 60 | STAGE | 6 | non |
| Boom stand | 96 | 21 | 77 | LX | 4 | non |

## Example: Moving Company

| nom | largeur | profondeur | hauteur |
|-----|---------|------------|---------|
| Wardrobe box | 24 | 24 | 48 |
| Large box | 18 | 18 | 24 |
| Medium box | 18 | 14 | 16 |
| Dresser | 36 | 20 | 48 |
| Mattress (king) | 76 | 10 | 80 |
| Sofa | 84 | 36 | 34 |

## Tips
- All dimensions in **inches**
- Cases with the same `group` name will be placed in the same wall when possible
- Floor panels (`is_floor = oui`) are always loaded first at the back of the truck with load bars between rows
- The solver will try to rotate cases to fit better unless `allow_rotation = non`
- Use `dept` to visually distinguish different departments in the 3D view
