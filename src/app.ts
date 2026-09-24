// Cross-scene singletons.
import type { WorldGeo } from './map/WorldGeo';
import { AudioManager } from './audio/AudioManager';

export const App = {
  geo: null as WorldGeo | null,
  audio: new AudioManager(),
};
