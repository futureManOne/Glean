import { expect, test, describe } from 'bun:test';

/**
 * Subtitle layout calculation mirroring the mathematical seam in SubtitleOverlay.tsx
 */
export function calculateSubtitleBounds(
  videoRect: { left: number; width: number; height?: number; bottom?: number } | null,
  windowWidth: number,
  isSidePanelOpen: boolean,
  panelWidth: number = 420,
  isAd: boolean = false
) {
  const panelW = isSidePanelOpen ? panelWidth : 0;
  const videoLeft = videoRect ? videoRect.left : 0;
  const videoWidth = videoRect ? videoRect.width : windowWidth;
  const trueVideoCenterX = videoLeft + videoWidth / 2;

  const visibleLeft = videoLeft;
  const visibleRight = isSidePanelOpen
    ? Math.min(videoLeft + videoWidth, windowWidth - panelW)
    : (videoLeft + videoWidth);
  const visibleWidth = Math.max(280, visibleRight - visibleLeft);
  const visibleCenterX = visibleLeft + visibleWidth / 2;

  const rightControlsReserved = isAd ? 16 : 96;
  const rightBoundary = visibleRight - rightControlsReserved;
  const leftBoundary = visibleLeft + 16;
  const clearanceToRight = rightBoundary - trueVideoCenterX;

  let targetCenterX: number;
  if (clearanceToRight >= 160) {
    targetCenterX = trueVideoCenterX;
  } else {
    targetCenterX = Math.max(visibleCenterX - rightControlsReserved / 2, Math.min(trueVideoCenterX, rightBoundary - 140));
  }

  const maxHalfWidth = Math.max(120, Math.min(
    targetCenterX - leftBoundary,
    rightBoundary - targetCenterX
  ));
  const containerWidth = Math.min(1100, Math.max(240, Math.round(maxHalfWidth * 2)));
  const containerLeft = Math.round(targetCenterX - containerWidth / 2);

  const controlsRightPx = Math.max(16, windowWidth - visibleRight + 16);

  return {
    trueVideoCenterX,
    targetCenterX,
    containerLeft,
    containerWidth,
    containerCenterX: containerLeft + containerWidth / 2,
    diffFromVideoCenter: (containerLeft + containerWidth / 2) - trueVideoCenterX,
    controlsRightPx
  };
}

describe('Subtitle Horizontal Centering', () => {
  test('keeps subtitle strictly centered (0px diff) in Fullscreen when side panel is open', () => {
    // 1440x900 MacBook viewport, fullscreen video
    const layout = calculateSubtitleBounds({ left: 0, width: 1440 }, 1440, true, 420);
    expect(layout.diffFromVideoCenter).toBe(0);
    expect(layout.containerCenterX).toBe(720);
    expect(layout.targetCenterX).toBe(720);
    // Right controls must not overlap side panel (side panel starts at 1020, controls stay at <= 1004)
    expect(layout.controlsRightPx).toBe(436);
  });

  test('keeps subtitle strictly centered (0px diff) in Fullscreen when side panel is closed', () => {
    const layout = calculateSubtitleBounds({ left: 0, width: 1440 }, 1440, false, 420);
    expect(layout.diffFromVideoCenter).toBe(0);
    expect(layout.containerCenterX).toBe(720);
    expect(layout.controlsRightPx).toBe(16);
  });

  test('keeps subtitle strictly centered on YouTube default view', () => {
    // YouTube player is centered/offset on left, width 800px, window 1440px
    const layout = calculateSubtitleBounds({ left: 24, width: 800 }, 1440, true, 420);
    expect(layout.diffFromVideoCenter).toBe(0);
    expect(layout.containerCenterX).toBe(424);
  });

  test('keeps subtitle strictly centered on 1920x1080 display with side panel open', () => {
    const layout = calculateSubtitleBounds({ left: 0, width: 1920 }, 1920, true, 420);
    expect(layout.diffFromVideoCenter).toBe(0);
    expect(layout.containerCenterX).toBe(960);
    expect(layout.controlsRightPx).toBe(436);
  });

  test('safely clamps without clipping on narrow viewport with side panel open', () => {
    // 1024x768 small viewport with 420px panel
    const layout = calculateSubtitleBounds({ left: 0, width: 1024 }, 1024, true, 420);
    // Should adapt smoothly and never clip off-screen
    expect(layout.containerLeft).toBeGreaterThanOrEqual(16);
    expect(layout.containerLeft + layout.containerWidth).toBeLessThanOrEqual(1024 - 420);
  });
});
