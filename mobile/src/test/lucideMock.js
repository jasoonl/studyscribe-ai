// Jest stand-in for lucide-react-native (ships ESM .mjs that Jest does not transform): every icon renders nothing.
const Icon = () => null;
module.exports = new Proxy({ __esModule: true }, { get: (target, name) => (name in target ? target[name] : Icon) });
