// Several topics at once (say French and algebra), each with its own chat
// and pathway. Saved in this browser only.

export const MAX_TOPICS = 6;
const SAVED_MESSAGES = 80;
const KEY = "sageTopics";
const OLD_KEY = "sageSession"; // single-chat format from earlier versions

//   store: { get(key), set(key, value), remove(key) }
export function createTopics(store, now = Date.now) {
  let data = store.get(KEY);
  if (!data || !Array.isArray(data.topics)) {
    data = { activeId: null, topics: [] };
    const old = store.get(OLD_KEY);
    if (old?.learner) {
      const id = newId();
      data = { activeId: id, topics: [{ id, celebrated: false, ...old, updatedAt: now() }] };
    }
    store.remove(OLD_KEY);
    store.set(KEY, data);
  }

  function persist() {
    store.set(KEY, {
      activeId: data.activeId,
      topics: data.topics.map((t) => ({ ...t, messages: t.messages.slice(-SAVED_MESSAGES) })),
    });
  }

  return {
    list: () => [...data.topics].sort((a, b) => b.updatedAt - a.updatedAt),
    active: () => data.topics.find((t) => t.id === data.activeId) || null,
    isFull: () => data.topics.length >= MAX_TOPICS,

    add(learner) {
      if (data.topics.length >= MAX_TOPICS) throw new Error("Too many topics");
      const topic = { id: newId(), learner, messages: [], celebrated: false, updatedAt: now() };
      data.topics.push(topic);
      data.activeId = topic.id;
      persist();
      return topic;
    },

    activate(id) {
      if (data.topics.some((t) => t.id === id)) data.activeId = id;
      persist();
      return this.active();
    },

    // Call after changing a topic's chat or progress.
    save(topic) {
      if (!data.topics.includes(topic)) return;
      topic.updatedAt = now();
      persist();
    },

    remove(id) {
      data.topics = data.topics.filter((t) => t.id !== id);
      if (data.activeId === id) data.activeId = null;
      persist();
    },

    // Leave the chat view without deleting anything.
    deactivate() {
      data.activeId = null;
      persist();
    },

    clearAll() {
      data = { activeId: null, topics: [] };
      persist();
    },
  };
}

function newId() {
  return Math.random().toString(36).slice(2, 10);
}
