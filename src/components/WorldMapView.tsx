// "Been"-app-style world map: every country as its own SVG path (pre-
// projected at build time, see src/data/worldMap.ts), colored in if the
// user has played a round there. Pure decoration + at-a-glance summary —
// tapping a country isn't wired up, the continent list below it is the
// interactive part.
import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Rect, Path } from 'react-native-svg';
import { COLORS } from '../theme';
import { COUNTRY_SHAPES, MAP_VIEWBOX } from '../data/worldMap';

const [, , VB_W, VB_H] = MAP_VIEWBOX.split(' ').map(Number);

export function WorldMapView({ visited, width }: { visited: Set<string>; width: number }) {
  const height = Math.round(width * (VB_H / VB_W));

  return (
    <View style={[styles.wrap, { width, height }]}>
      <Svg width={width} height={height} viewBox={MAP_VIEWBOX}>
        <Rect x={0} y={0} width={VB_W} height={VB_H} fill="#eaf3fa" />
        {COUNTRY_SHAPES.map((c, i) => {
          const isVisited = !!c.cca2 && visited.has(c.cca2);
          return (
            <Path
              key={c.cca2 ?? `_${i}`}
              d={c.path}
              fill={isVisited ? COLORS.primary : '#d6e0d9'}
              stroke={isVisited ? COLORS.success : '#eaf3fa'}
              strokeWidth={isVisited ? 0.8 : 0.5}
            />
          );
        })}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: 16, overflow: 'hidden', alignSelf: 'center' },
});
