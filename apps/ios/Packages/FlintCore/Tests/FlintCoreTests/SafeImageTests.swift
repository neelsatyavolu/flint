import FlintHTML
import Foundation
import Testing

@Suite("Safe image URLs")
struct SafeImageTests {
    private let me = ["reader@example.com"]

    @Test(arguments: [
        "https://cdn.brand.example/img/hero.jpg",
        "https://images.ctfassets.net/abc123/9b1f2e7a3c4d5e6f9b1f2e7a3c4d5e6f/banner.png?w=1200&fm=webp&q=80",
        "https://cdn.shopify.com/s/files/1/0012/files/hero_1200x.jpg?v=1699999999",
        "https://substackcdn.com/image/fetch/w_1456,c_limit,f_auto/logo.png",
    ])
    func loads(_ url: String) { #expect(SafeImage.isSafe(url, recipients: me)) }

    @Test(arguments: [
        "https://img.example/x.png?to=reader@example.com",
        "https://img.example/x.png?to=reader%40example.com",
        "https://img.example/list/other@example.org/x.png",
        "https://img.example/cmVhZGVyQGV4YW1wbGUuY29t.png",
        "https://e.example.com/o/eyJ1aWQiOiI4ZjNhOTEifQ/header.png",
        "https://img.example/logo.png?uid=42",
        "https://img.example/logo.png?ref=8812734019283",
        "https://img.example/open/8f3a91b2c4d5e6f7a8b9",
        "https://img.example/i/8f3a91b2c4d5e6f7a8b9c0d1",
        "https://img.example/aGVsbG8gd29ybGQ1MjM0NQ/logo.png",
        "http://cdn.brand.example/hero.jpg",
        "https://user:pw@cdn.brand.example/hero.jpg",
        "not a url",
    ])
    func holdsBack(_ url: String) { #expect(!SafeImage.isSafe(url, recipients: me)) }
}
