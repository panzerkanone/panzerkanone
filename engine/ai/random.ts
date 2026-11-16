/** An agent that picks one of the legal actions at random from its own stream. Works with any ruleset. */
import type { RandomStream } from '../core/random';
import type { Agent } from './agent';

export class RandomAgent<V, A> implements Agent<V, A> {
  readonly id = 'random';

  decide(_view: V, legal: readonly A[], stream: RandomStream): A {
    if (legal.length === 0) throw new Error('random agent: asked to decide with no legal action');
    return legal[stream.below(legal.length)] as A;
  }
}
