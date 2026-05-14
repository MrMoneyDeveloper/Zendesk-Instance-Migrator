export function parseJsonFile(file) {
  if (!file) {
    return Promise.reject(new Error("Select a migration bundle JSON file before validating."));
  }

  return file.text().then((text) => {
    try {
      return JSON.parse(text);
    } catch (error) {
      const wrapped = new Error("The selected file is not valid JSON.");
      wrapped.cause = error;
      throw wrapped;
    }
  });
}
