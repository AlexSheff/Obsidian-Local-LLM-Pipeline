const content = "---\r\ntags:\r\n  - old\r\ncategory: test\r\n---\r\nbody text";
const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
console.log("fmMatch:", !!fmMatch);

let existingFrontmatter = fmMatch ? fmMatch[1] : '';
console.log("existing:", existingFrontmatter);

let newFrontmatterBody = existingFrontmatter;
const tagsYaml = "\n  - \"#new\"";
if (newFrontmatterBody.includes('tags:')) {
  newFrontmatterBody = newFrontmatterBody.replace(/tags:[\s\S]*?(?=(?:\r?\n\w+:|$))/i, `tags:${tagsYaml}`);
}
console.log("replaced:\n" + newFrontmatterBody);
