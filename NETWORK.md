# Network boundary

Lens reads, parses, searches, and converts selected JSON and CSV files inside the browser. Application assets and cookie-free page analytics use Clyvora's own origin. Lens does not send filenames, file contents, search terms, or converted output over the network.

The production Content Security Policy limits connections to the same origin. Any new outbound connection requires a documented review and an update to this file.
