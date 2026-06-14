import { useEffect, useRef } from 'react';
import { Animated, Platform } from 'react-native';

export const USE_NATIVE_DRIVER = Platform.OS !== 'web';

export function usePressScale(toPressed = 0.95) {
  const scale = useRef(new Animated.Value(1)).current;
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      scale.stopAnimation();
    };
  }, [scale]);

  const animateTo = (toValue: number) => {
    if (!mounted.current) return;
    Animated.spring(scale, {
      toValue,
      damping: 15,
      stiffness: 300,
      useNativeDriver: USE_NATIVE_DRIVER,
    }).start();
  };

  return {
    scale,
    onPressIn: () => animateTo(toPressed),
    onPressOut: () => animateTo(1),
  };
}
