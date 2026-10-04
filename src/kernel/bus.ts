// L0 事件总线 —— 主文档 §3.2.1:组件经总线收发,不直接互调。

import type { Disposable, EventKey, TypedEvent } from "./types.js";

type Handler = (e: TypedEvent) => void;

export class EventBus {
  private readonly handlers = new Map<string, Set<Handler>>();

  emit(evt: TypedEvent): void {
    for (const h of this.handlers.get(evt.type) ?? []) h(evt);
    for (const h of this.handlers.get("*") ?? []) h(evt); // 通配订阅(观测/审计用)
  }

  on<T extends TypedEvent>(key: EventKey<T> | "*", handler: (e: T) => void): Disposable {
    const type = key === "*" ? "*" : key.type;
    const set = this.handlers.get(type) ?? new Set<Handler>();
    const wrapped = handler as Handler;
    set.add(wrapped);
    this.handlers.set(type, set);
    return { dispose: () => set.delete(wrapped) };
  }
}
