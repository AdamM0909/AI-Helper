// Some models write their reasoning inside <think> tags. This hides it from
// students, even when a tag is split across streamed chunks.
export function createThinkFilter() {
  let pending = "";
  let thinking = false;
  return function push(chunk) {
    pending += chunk;
    let visible = "";
    for (;;) {
      const tag = thinking ? "</think>" : "<think>";
      const at = pending.indexOf(tag);
      if (at !== -1) {
        if (!thinking) visible += pending.slice(0, at);
        pending = pending.slice(at + tag.length);
        thinking = !thinking;
        continue;
      }
      // Hold back anything that might be the start of a tag.
      const lt = pending.lastIndexOf("<");
      const keep = lt !== -1 && tag.startsWith(pending.slice(lt)) ? pending.length - lt : 0;
      if (!thinking) visible += pending.slice(0, pending.length - keep);
      pending = pending.slice(pending.length - keep);
      return visible;
    }
  };
}
