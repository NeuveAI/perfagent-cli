"use client";

import { useState, useEffect, useCallback } from "react";

// ─── Types ───────────────────────────────────────────────
type ItemStack = { id: string; count: number } | null;

type BlockTextures = {
  top: HTMLImageElement;
  side: HTMLImageElement;
  front: HTMLImageElement;
};

// ─── Constants ───────────────────────────────────────────
const S = 3; // scale factor (1 MC pixel = 3 CSS px)
const SLOT = 18 * S;
const SLOT_INNER = 16 * S;
const GUI_W = 176 * S;
const GUI_H = 166 * S;

const ITEM_NAMES: Record<string, string> = {
  oak_log: "Oak Log",
  oak_planks: "Oak Planks",
};

// ─── Texture paths (real Minecraft Beta 1.6 textures) ───
const BLOCK_TEXTURE_PATHS: Record<
  string,
  { top: string; side: string; front: string }
> = {
  oak_log: {
    top: "/textures/oak_log_top.png",
    side: "/textures/oak_log_side.png",
    front: "/textures/oak_log_side.png",
  },
  oak_planks: {
    top: "/textures/oak_planks_flat.png",
    side: "/textures/oak_planks_flat.png",
    front: "/textures/oak_planks_flat.png",
  },
};

// ─── Load an image as a promise ─────────────────────────
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// ─── Render a 3D isometric block to a data URL ─────────
// Uses real Minecraft isometric projection:
//   3D x → screen (1, 0.5)
//   3D z → screen (-1, 0.5)
//   3D y → screen (0, -1)
// Fits a 16-unit cube into a 32x32 canvas (scale = 0.5)
function renderIsometricBlock(textures: BlockTextures): string {
  const canvas = document.createElement("canvas");
  // Use higher resolution for crisp rendering
  const size = 32;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  // Disable image smoothing for crisp pixel art
  ctx.imageSmoothingEnabled = false;

  // Face transforms map 16x16 texture to isometric parallelograms
  // Scale factor: 16 texture px → 16 screen px (cube fits in ~32x32)

  // Draw order: left, right, top (painter's algorithm)

  // LEFT FACE (z=S plane, south-facing)
  // Maps texture (0,0)→(0,8), (16,0)→(16,16), (0,16)→(0,24)
  ctx.save();
  ctx.setTransform(1, 0.5, 0, 1, 0, 8);
  ctx.drawImage(textures.side, 0, 0, 16, 16);
  // Darken: south face = 0.8 brightness → 20% dark overlay
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ctx.fillRect(0, 0, 16, 16);
  ctx.restore();

  // RIGHT FACE (x=S plane, east-facing)
  // Maps texture (0,0)→(32,8), (16,0)→(16,16), (0,16)→(32,24)
  ctx.save();
  ctx.setTransform(-1, 0.5, 0, 1, 32, 8);
  ctx.drawImage(textures.front, 0, 0, 16, 16);
  // Darken: east face = 0.6 brightness → 40% dark overlay
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.fillRect(0, 0, 16, 16);
  ctx.restore();

  // TOP FACE (y=S plane)
  // Maps texture (0,0)→(16,0), (16,0)→(32,8), (0,16)→(0,8)
  ctx.save();
  ctx.setTransform(1, 0.5, -1, 0.5, 16, 0);
  ctx.drawImage(textures.top, 0, 0, 16, 16);
  ctx.restore();

  return canvas.toDataURL();
}

// Dirt background uses the real texture from /textures/dirt.png
const DIRT_BG_SIZE = 16 * 4; // tile at 4x scale for the classic look

// ─── Arrow SVG (right-pointing, Minecraft style) ────────
function ArrowIcon({ active }: { active: boolean }) {
  return (
    <svg
      width={22 * S}
      height={15 * S}
      viewBox="0 0 22 15"
      style={{ imageRendering: "pixelated" }}
    >
      <rect
        x="0"
        y="3"
        width="16"
        height="9"
        fill={active ? "#8B8B8B" : "#C6C6C6"}
      />
      <rect
        x="0"
        y="4"
        width="15"
        height="7"
        fill={active ? "#fff" : "#DBDBDB"}
      />
      {active && (
        <>
          <rect x="1" y="5" width="13" height="5" fill="#6E9E33" />
          <rect x="1" y="5" width="13" height="2" fill="#7DB63A" />
        </>
      )}
      <polygon
        points="16,0 22,7.5 16,15"
        fill={active ? "#6E9E33" : "#A5A5A5"}
      />
      <polygon
        points="16,1 21,7.5 16,14"
        fill={active ? "#7DB63A" : "#C6C6C6"}
      />
      <polygon
        points="16,3 19,7.5 16,12"
        fill={active ? "#8BC63F" : "#DBDBDB"}
      />
    </svg>
  );
}

// ─── Slot Component ─────────────────────────────────────
function Slot({
  item,
  textures,
  onClick,
  onRightClick,
  large,
}: {
  item: ItemStack;
  textures: Record<string, string>;
  onClick: () => void;
  onRightClick: () => void;
  large?: boolean;
}) {
  const size = large ? SLOT + 8 * S : SLOT;
  const border = large ? 2 * S : S;

  return (
    <div
      onClick={onClick}
      onContextMenu={(e) => {
        e.preventDefault();
        onRightClick();
      }}
      style={{
        width: size,
        height: size,
        position: "relative",
        cursor: "pointer",
        borderTop: `${border}px solid #373737`,
        borderLeft: `${border}px solid #373737`,
        borderBottom: `${border}px solid #FFF`,
        borderRight: `${border}px solid #FFF`,
        backgroundColor: "#8B8B8B",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {item && textures[item.id] && (
        <>
          <img
            src={textures[item.id]}
            alt={item.id}
            width={SLOT_INNER}
            height={SLOT_INNER}
            draggable={false}
            style={{
              imageRendering: "pixelated",
              pointerEvents: "none",
            }}
          />
          {item.count > 1 && (
            <span
              style={{
                position: "absolute",
                bottom: 1 * S,
                right: 1 * S,
                color: "#FFF",
                fontSize: 8 * S,
                fontFamily: "monospace",
                fontWeight: "bold",
                textShadow: `${S}px ${S}px 0 #3F3F3F`,
                lineHeight: 1,
                pointerEvents: "none",
              }}
            >
              {item.count}
            </span>
          )}
        </>
      )}
    </div>
  );
}

// ─── Tooltip ─────────────────────────────────────────────
function Tooltip({ item, x, y }: { item: ItemStack; x: number; y: number }) {
  if (!item) return null;
  const name = ITEM_NAMES[item.id] || item.id;
  return (
    <div
      style={{
        position: "fixed",
        left: x + 12,
        top: y - 12,
        background: "#100010",
        border: `${S}px solid #250066`,
        borderTop: `${S}px solid #5000FF`,
        borderLeft: `${S}px solid #5000FF`,
        color: "#FFF",
        padding: `${2 * S}px ${4 * S}px`,
        fontSize: 8 * S,
        fontFamily: "monospace",
        pointerEvents: "none",
        zIndex: 2000,
        whiteSpace: "nowrap",
      }}
    >
      {name}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────
export default function CraftingTable() {
  const [itemIcons, setItemIcons] = useState<Record<string, string>>({});
  const [ready, setReady] = useState(false);

  // Inventory: 36 slots (0-26 = main, 27-35 = hotbar)
  const [inventory, setInventory] = useState<ItemStack[]>(() => {
    const inv: ItemStack[] = new Array(36).fill(null);
    inv[0] = { id: "oak_log", count: 1 };
    return inv;
  });

  const [craftingGrid, setCraftingGrid] = useState<ItemStack[]>(
    new Array(9).fill(null)
  );
  const [craftingOutput, setCraftingOutput] = useState<ItemStack>(null);
  const [heldItem, setHeldItem] = useState<ItemStack>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [hoveredItem, setHoveredItem] = useState<ItemStack>(null);

  // Load real textures and create 3D isometric renders
  useEffect(() => {
    async function loadTextures() {
      const icons: Record<string, string> = {};

      for (const [blockId, paths] of Object.entries(BLOCK_TEXTURE_PATHS)) {
        const [top, side, front] = await Promise.all([
          loadImage(paths.top),
          loadImage(paths.side),
          loadImage(paths.front),
        ]);
        icons[blockId] = renderIsometricBlock({ top, side, front });
      }

      setItemIcons(icons);
      setReady(true);
    }

    loadTextures();
  }, []);

  // Mouse tracking
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY });
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  // Check crafting recipes whenever grid changes
  useEffect(() => {
    const filled = craftingGrid.filter((item) => item !== null);
    if (filled.length === 1 && filled[0]!.id === "oak_log") {
      setCraftingOutput({ id: "oak_planks", count: 4 });
    } else {
      setCraftingOutput(null);
    }
  }, [craftingGrid]);

  // ─── Click Handlers ──────────────────────────────────
  const handleSlotClick = useCallback(
    (type: "inventory" | "crafting" | "output", index: number) => {
      if (type === "output") {
        if (!craftingOutput) return;
        if (heldItem && heldItem.id !== craftingOutput.id) return;
        if (heldItem && heldItem.count + craftingOutput.count > 64) return;

        const newHeld = heldItem
          ? { ...heldItem, count: heldItem.count + craftingOutput.count }
          : { ...craftingOutput };
        setHeldItem(newHeld);

        setCraftingGrid((prev) =>
          prev.map((item) => {
            if (!item) return null;
            const n = item.count - 1;
            return n > 0 ? { ...item, count: n } : null;
          })
        );
        return;
      }

      const items =
        type === "inventory" ? [...inventory] : [...craftingGrid];
      const setItems =
        type === "inventory" ? setInventory : setCraftingGrid;
      const slot = items[index];

      if (!heldItem && !slot) return;

      if (!heldItem && slot) {
        setHeldItem(slot);
        items[index] = null;
      } else if (heldItem && !slot) {
        items[index] = heldItem;
        setHeldItem(null);
      } else if (heldItem && slot && heldItem.id === slot.id) {
        const total = slot.count + heldItem.count;
        if (total <= 64) {
          items[index] = { ...slot, count: total };
          setHeldItem(null);
        } else {
          items[index] = { ...slot, count: 64 };
          setHeldItem({ ...heldItem, count: total - 64 });
        }
      } else if (heldItem && slot) {
        items[index] = heldItem;
        setHeldItem(slot);
      }
      setItems(items);
    },
    [heldItem, inventory, craftingGrid, craftingOutput]
  );

  const handleSlotRightClick = useCallback(
    (type: "inventory" | "crafting" | "output", index: number) => {
      if (type === "output") return;

      const items =
        type === "inventory" ? [...inventory] : [...craftingGrid];
      const setItems =
        type === "inventory" ? setInventory : setCraftingGrid;
      const slot = items[index];

      if (heldItem && !slot) {
        items[index] = { id: heldItem.id, count: 1 };
        if (heldItem.count <= 1) {
          setHeldItem(null);
        } else {
          setHeldItem({ ...heldItem, count: heldItem.count - 1 });
        }
      } else if (
        heldItem &&
        slot &&
        heldItem.id === slot.id &&
        slot.count < 64
      ) {
        items[index] = { ...slot, count: slot.count + 1 };
        if (heldItem.count <= 1) {
          setHeldItem(null);
        } else {
          setHeldItem({ ...heldItem, count: heldItem.count - 1 });
        }
      } else if (!heldItem && slot) {
        const take = Math.ceil(slot.count / 2);
        setHeldItem({ id: slot.id, count: take });
        const remain = slot.count - take;
        items[index] = remain > 0 ? { ...slot, count: remain } : null;
      }
      setItems(items);
    },
    [heldItem, inventory, craftingGrid]
  );

  // ─── Render ──────────────────────────────────────────
  if (!ready) {
    return (
      <div
        style={{
          width: "100vw",
          height: "100vh",
          background: "#000",
        }}
      />
    );
  }

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: `url(/textures/dirt.png)`,
        backgroundSize: `${DIRT_BG_SIZE}px ${DIRT_BG_SIZE}px`,
        backgroundRepeat: "repeat",
        imageRendering: "pixelated",
        cursor: heldItem ? "none" : "default",
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Dark overlay */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.56)",
          pointerEvents: "none",
        }}
      />

      {/* GUI Panel */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          width: GUI_W,
          height: GUI_H,
          backgroundColor: "#C6C6C6",
          border: `${2 * S}px solid`,
          borderColor: "#FFF #555 #555 #FFF",
          padding: 0,
        }}
      >
        {/* Title: "Crafting" */}
        <div
          style={{
            position: "absolute",
            top: 6 * S,
            left: 28 * S,
            color: "#404040",
            fontSize: 8 * S,
            fontFamily: "monospace",
            fontWeight: "bold",
            letterSpacing: S,
          }}
        >
          Crafting
        </div>

        {/* 3x3 Crafting Grid */}
        {Array.from({ length: 3 }).map((_, row) =>
          Array.from({ length: 3 }).map((_, col) => {
            const idx = row * 3 + col;
            return (
              <div
                key={`craft-${idx}`}
                style={{
                  position: "absolute",
                  left: (30 + col * 18) * S,
                  top: (17 + row * 18) * S,
                }}
                onMouseEnter={() => setHoveredItem(craftingGrid[idx])}
                onMouseLeave={() => setHoveredItem(null)}
              >
                <Slot
                  item={craftingGrid[idx]}
                  textures={itemIcons}
                  onClick={() => handleSlotClick("crafting", idx)}
                  onRightClick={() =>
                    handleSlotRightClick("crafting", idx)
                  }
                />
              </div>
            );
          })
        )}

        {/* Arrow */}
        <div
          style={{
            position: "absolute",
            left: 90 * S,
            top: 35 * S,
            display: "flex",
            alignItems: "center",
          }}
        >
          <ArrowIcon active={craftingOutput !== null} />
        </div>

        {/* Output Slot */}
        <div
          style={{
            position: "absolute",
            left: 124 * S,
            top: 31 * S,
          }}
          onMouseEnter={() => setHoveredItem(craftingOutput)}
          onMouseLeave={() => setHoveredItem(null)}
        >
          <Slot
            item={craftingOutput}
            textures={itemIcons}
            large
            onClick={() => handleSlotClick("output", 0)}
            onRightClick={() => {}}
          />
        </div>

        {/* Main Inventory (3 rows x 9 cols) */}
        {Array.from({ length: 3 }).map((_, row) =>
          Array.from({ length: 9 }).map((_, col) => {
            const idx = row * 9 + col;
            return (
              <div
                key={`inv-${idx}`}
                style={{
                  position: "absolute",
                  left: (8 + col * 18) * S,
                  top: (84 + row * 18) * S,
                }}
                onMouseEnter={() => setHoveredItem(inventory[idx])}
                onMouseLeave={() => setHoveredItem(null)}
              >
                <Slot
                  item={inventory[idx]}
                  textures={itemIcons}
                  onClick={() => handleSlotClick("inventory", idx)}
                  onRightClick={() =>
                    handleSlotRightClick("inventory", idx)
                  }
                />
              </div>
            );
          })
        )}

        {/* Hotbar (1 row x 9 cols) */}
        {Array.from({ length: 9 }).map((_, col) => {
          const idx = 27 + col;
          return (
            <div
              key={`hot-${idx}`}
              style={{
                position: "absolute",
                left: (8 + col * 18) * S,
                top: 142 * S,
              }}
              onMouseEnter={() => setHoveredItem(inventory[idx])}
              onMouseLeave={() => setHoveredItem(null)}
            >
              <Slot
                item={inventory[idx]}
                textures={itemIcons}
                onClick={() => handleSlotClick("inventory", idx)}
                onRightClick={() =>
                  handleSlotRightClick("inventory", idx)
                }
              />
            </div>
          );
        })}
      </div>

      {/* Held item following cursor */}
      {heldItem && itemIcons[heldItem.id] && (
        <div
          style={{
            position: "fixed",
            left: mousePos.x - SLOT_INNER / 2,
            top: mousePos.y - SLOT_INNER / 2,
            pointerEvents: "none",
            zIndex: 3000,
          }}
        >
          <img
            src={itemIcons[heldItem.id]}
            alt={heldItem.id}
            width={SLOT_INNER}
            height={SLOT_INNER}
            draggable={false}
            style={{ imageRendering: "pixelated" }}
          />
          {heldItem.count > 1 && (
            <span
              style={{
                position: "absolute",
                bottom: 0,
                right: 1 * S,
                color: "#FFF",
                fontSize: 8 * S,
                fontFamily: "monospace",
                fontWeight: "bold",
                textShadow: `${S}px ${S}px 0 #3F3F3F`,
                lineHeight: 1,
              }}
            >
              {heldItem.count}
            </span>
          )}
        </div>
      )}

      {/* Tooltip */}
      {!heldItem && hoveredItem && (
        <Tooltip item={hoveredItem} x={mousePos.x} y={mousePos.y} />
      )}
    </div>
  );
}
