export function createNavigator() {
  let current = 0;
  return {
    begin() {
      const id = ++current;
      return () => id === current;
    },
  };
}
