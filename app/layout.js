import "./globals.css";

export const metadata = {
  title: "HeyNow Source Registry",
  description: "Internal HeyNow source operations"
};

export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
