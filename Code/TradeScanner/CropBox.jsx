/**
 * Trade Scanner crop step (2026-11-01): every picked photo or screenshot is
 * shown here first and the user drags a frame around the trade window only.
 * Desks, taskbars, chat and other windows in the picture are what make the
 * scanner find items that are not in the trade, so the frame is required.
 *
 * Plain PanResponder, no native module: drag a corner to resize, drag inside
 * to move. onChange gets the frame as shares of the picture
 * ({ x, y, w, h }, 0..1), the same for the pixel worker and the text reader
 * whatever size each one reads the picture at.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Image, PanResponder, StyleSheet } from 'react-native';

export const FULL_CROP = { x: 0, y: 0, w: 1, h: 1 };
const START = { x: 0.05, y: 0.05, w: 0.9, h: 0.9 };
const MIN = 0.12; // smallest frame side, share of the picture
const HANDLE = 30;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export default function CropBox({ uri, imageWidth, imageHeight, maxHeight, color, onChange }) {
  const [size, setSize] = useState(imageWidth && imageHeight ? { w: imageWidth, h: imageHeight } : null);
  const [box, setBox] = useState(null); // shown picture size in points
  const [crop, setCrop] = useState(START);
  const boxRef = useRef(null);
  const cropRef = useRef(START);
  const startRef = useRef(START);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;

  useEffect(() => {
    changeRef.current?.(START);
    if (size) return;
    Image.getSize(uri, (w, h) => setSize({ w, h }), () => setSize({ w: 1, h: 1 }));
  }, [uri]); // eslint-disable-line react-hooks/exhaustive-deps

  const [outer, setOuter] = useState(0);
  useEffect(() => {
    if (!outer || !size) return;
    const ratio = size.h / size.w;
    let w = outer;
    let h = w * ratio;
    if (h > maxHeight) { h = maxHeight; w = h / ratio; }
    boxRef.current = { w, h };
    setBox({ w, h });
  }, [outer, size, maxHeight]);

  const handlers = useMemo(() => {
    const make = (mode) => PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => { startRef.current = cropRef.current; },
      onPanResponderMove: (_, g) => {
        const b = boxRef.current;
        if (!b) return;
        const s = startRef.current;
        const dx = g.dx / b.w;
        const dy = g.dy / b.h;
        let next;
        if (mode === 'move') {
          next = { ...s, x: clamp(s.x + dx, 0, 1 - s.w), y: clamp(s.y + dy, 0, 1 - s.h) };
        } else {
          let x0 = s.x; let y0 = s.y; let x1 = s.x + s.w; let y1 = s.y + s.h;
          if (mode[1] === 'l') x0 = clamp(x0 + dx, 0, x1 - MIN); else x1 = clamp(x1 + dx, x0 + MIN, 1);
          if (mode[0] === 't') y0 = clamp(y0 + dy, 0, y1 - MIN); else y1 = clamp(y1 + dy, y0 + MIN, 1);
          next = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
        }
        cropRef.current = next;
        setCrop(next);
        changeRef.current?.(next);
      },
    });
    return { move: make('move'), tl: make('tl'), tr: make('tr'), bl: make('bl'), br: make('br') };
  }, []);

  const left = box ? crop.x * box.w : 0;
  const top = box ? crop.y * box.h : 0;
  const width = box ? crop.w * box.w : 0;
  const height = box ? crop.h * box.h : 0;

  const corner = (key, style) => (
    <View
      key={key}
      {...handlers[key].panHandlers}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      style={[styles.handle, style]}
    >
      <View style={[styles.handleMark, { borderColor: color }, key[0] === 't' ? styles.markTop : styles.markBottom, key[1] === 'l' ? styles.markLeft : styles.markRight]} />
    </View>
  );

  return (
    <View style={styles.outer} onLayout={(e) => setOuter(e.nativeEvent.layout.width)}>
      {box && (
        <View style={{ width: box.w, height: box.h }}>
          <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="stretch" />
          {/* Dim everything outside the frame. */}
          <View style={[styles.dim, { left: 0, top: 0, right: 0, height: top }]} pointerEvents="none" />
          <View style={[styles.dim, { left: 0, top: top + height, right: 0, bottom: 0 }]} pointerEvents="none" />
          <View style={[styles.dim, { left: 0, top, width: left, height }]} pointerEvents="none" />
          <View style={[styles.dim, { left: left + width, top, right: 0, height }]} pointerEvents="none" />
          <View {...handlers.move.panHandlers} style={[styles.frame, { left, top, width, height, borderColor: color }]}>
            <View style={[styles.grid, styles.gridV, { left: '33.3%' }]} pointerEvents="none" />
            <View style={[styles.grid, styles.gridV, { left: '66.6%' }]} pointerEvents="none" />
            <View style={[styles.grid, styles.gridH, { top: '33.3%' }]} pointerEvents="none" />
            <View style={[styles.grid, styles.gridH, { top: '66.6%' }]} pointerEvents="none" />
          </View>
          {corner('tl', { left: left - HANDLE / 2, top: top - HANDLE / 2 })}
          {corner('tr', { left: left + width - HANDLE / 2, top: top - HANDLE / 2 })}
          {corner('bl', { left: left - HANDLE / 2, top: top + height - HANDLE / 2 })}
          {corner('br', { left: left + width - HANDLE / 2, top: top + height - HANDLE / 2 })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { width: '100%', alignItems: 'center' },
  dim: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.55)' },
  frame: { position: 'absolute', borderWidth: 2 },
  grid: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.35)' },
  gridV: { top: 0, bottom: 0, width: StyleSheet.hairlineWidth },
  gridH: { left: 0, right: 0, height: StyleSheet.hairlineWidth },
  handle: { position: 'absolute', width: HANDLE, height: HANDLE },
  // An L on the frame corner, drawn into the frame.
  handleMark: { position: 'absolute', width: 18, height: 18 },
  markTop: { borderTopWidth: 4, top: HANDLE / 2 - 2 },
  markBottom: { borderBottomWidth: 4, bottom: HANDLE / 2 - 2 },
  markLeft: { borderLeftWidth: 4, left: HANDLE / 2 - 2 },
  markRight: { borderRightWidth: 4, right: HANDLE / 2 - 2 },
});
