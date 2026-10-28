// `GRDBStore` is the production `Store`. Each repository's methods are implemented in Repositories/.

extension GRDBStore: ThreadsRepository {}
extension GRDBStore: Store {}
