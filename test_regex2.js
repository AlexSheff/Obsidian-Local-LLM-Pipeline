const content = "---\r\ntags:\r\n  - old\r\ncategory: test\r\n---\r\nbody text";
const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
console.log("fmMatch Old:", !!fmMatch);
